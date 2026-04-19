import sdk, {
    Setting,
    Intercom,
    Settings,
    FFmpegInput,
    MediaObject,
    VideoCamera,
    BinarySensor,
    SettingValue,
    ScryptedInterface,
    ScryptedMimeTypes,
    ScryptedDeviceBase,
    RequestMediaStreamOptions,
    ResponseMediaStreamOptions
} from '@scrypted/sdk';
import net from 'node:net';

import { IntercomSession } from './intercom-session';
import { TYPE_ACK, buildPacket, parsePacket, TYPE_STOP_VOICE, TYPE_START_VOICE } from './protocol';

const { mediaManager } = sdk;

type ChannelId = 'ch1' | 'ch2' | 'ch3';

interface ChannelDescriptor {
    name: string;
    id: ChannelId;
    width: number;
    height: number;
}

/**
 * Aqara G410 exposes three RTSP channels on port 8554.
 * Dimensions observed from one G410 unit; actual dimensions come from the
 * RTSP probe so these are informational only.
 */
const CHANNELS: Record<ChannelId, ChannelDescriptor> = {
    ch3: { id: 'ch3', width: 640, height: 480, name: 'Sub (640x480)' },
    ch1: { id: 'ch1', width: 1600, height: 1200, name: 'Main (1600x1200)' },
    ch2: { id: 'ch2', width: 1280, height: 720, name: 'Medium (1280x720)' }
};

export class AqaraCamera extends ScryptedDeviceBase implements BinarySensor, Intercom, Settings, VideoCamera {
    private intercomSession?: IntercomSession;

    constructor(nativeId: string) {
        super(nativeId);
        this.online = true;
        // BinarySensor is declared only to satisfy HomeKit's Doorbell accessory
        // requirements. We can't detect actual doorbell presses (see README), so
        // reset any stale state on startup.
        this.binaryState = false;
    }

    async getSettings(): Promise<Setting[]> {
        const channelChoices = Object.keys(CHANNELS);
        const channelSummary = Object.values(CHANNELS)
            .map(c => `${c.id} = ${c.name}`)
            .join(', ');

        return [
            {
                key: 'host',
                title: 'IP Address or Hostname',
                value: this.storage.getItem('host') || ''
            },
            {
                key: 'rtspPort',
                title: 'RTSP Port',
                description: 'Default is 8554.',
                value: this.storage.getItem('rtspPort') || '8554'
            },
            {
                key: 'username',
                title: 'RTSP Username',
                value: this.storage.getItem('username') || ''
            },
            {
                key: 'password',
                type: 'password',
                title: 'RTSP Password',
                value: this.storage.getItem('password') || ''
            },
            {
                key: 'mainChannel',
                choices: channelChoices,
                title: 'Main Stream Channel',
                value: this.resolveChannelId('mainChannel', 'ch1'),
                description: `Used for full-quality recording (HKSV/NVR). ${channelSummary}.`
            },
            {
                key: 'subChannel',
                choices: channelChoices,
                title: 'Substream Channel',
                value: this.resolveChannelId('subChannel', 'ch3'),
                description: `Low-bitrate stream for thumbnails. ${channelSummary}.`
            },
            {
                type: 'button',
                key: 'probeIntercom',
                title: 'Test Intercom Connection',
                description:
                    'Opens a TCP session to the camera on port 54324, sends START_VOICE, logs the response, then closes. Use to verify protocol compatibility before trying real talkback.'
            },
            {
                type: 'button',
                key: 'testTone',
                title: 'Play Test Tone (3s)',
                description:
                    "Runs the full intercom pipeline (TCP session + UDP RTP + ffmpeg AAC) by streaming a 3-second 440Hz sine wave to the camera's speaker. Listen to the camera — if you hear a beep, 2-way audio works."
            }
        ];
    }

    // ---------- Settings ----------

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        const requestedId = (options?.id as ChannelId) || undefined;
        const mainId = this.resolveChannelId('mainChannel', 'ch1');
        const channelId = requestedId && requestedId in CHANNELS ? requestedId : mainId;

        const url = this.buildRtspUrl(channelId);
        const channel = CHANNELS[channelId];

        const ffmpegInput: FFmpegInput = {
            url,
            container: 'rtsp',
            inputArguments: ['-rtsp_transport', 'tcp', '-i', url],
            mediaStreamOptions: {
                id: channelId,
                source: 'local',
                tool: 'scrypted',
                container: 'rtsp',
                name: channel.name,
                audio: { codec: 'aac' },
                video: {
                    codec: 'h264',
                    width: channel.width,
                    height: channel.height
                }
            }
        };

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        const mainId = this.resolveChannelId('mainChannel', 'ch1');
        const subId = this.resolveChannelId('subChannel', 'ch3');

        const toOption = (id: ChannelId): ResponseMediaStreamOptions => {
            const c = CHANNELS[id];
            return {
                id,
                name: c.name,
                source: 'local',
                tool: 'scrypted',
                container: 'rtsp',
                audio: { codec: 'aac' },
                userConfigurable: false,
                video: { codec: 'h264', width: c.width, height: c.height }
            };
        };

        const options: ResponseMediaStreamOptions[] = [toOption(mainId)];
        if (subId !== mainId) {
            options.push(toOption(subId));
        }
        return options;
    }

    // ---------- VideoCamera ----------

    async putSetting(key: string, value: SettingValue): Promise<void> {
        if (key === 'probeIntercom') {
            await this.probeIntercom();
            return;
        }
        if (key === 'testTone') {
            await this.playTestTone();
            return;
        }
        if (key === 'mainChannel' || key === 'subChannel') {
            const id = String(value).trim() as ChannelId;
            if (!(id in CHANNELS)) {
                throw new Error(`Unknown channel: ${value}`);
            }
            this.storage.setItem(key, id);
        } else {
            this.storage.setItem(key, value === undefined ? '' : String(value));
        }
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    release(): void {
        void this.intercomSession?.stop('device-released');
    }

    // ---------- Intercom probe (diagnostic) ----------

    async startIntercom(media: MediaObject): Promise<void> {
        const host = (this.storage.getItem('host') || '').trim();
        if (!host) {
            throw new Error('Camera host is not configured. Open settings and set the IP Address.');
        }

        // If a session is already active, tear it down first.
        if (this.intercomSession) {
            await this.intercomSession.stop('restart');
            this.intercomSession = undefined;
        }

        // Scrypted gives us a MediaObject. Convert to FFmpegInput so we can feed
        // the input arguments directly to ffmpeg for AAC-ADTS encoding.
        const ffmpegInputRaw = await mediaManager.convertMediaObject<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);
        const inputArgs = ffmpegInputRaw.inputArguments;
        if (!inputArgs?.length) {
            throw new Error('MediaObject did not produce ffmpeg input arguments — cannot start intercom');
        }
        this.console.log(`[intercom] media input args: ${JSON.stringify(inputArgs)}`);

        const ffmpegPath = await mediaManager.getFFmpegPath();

        const session = new IntercomSession(host, this.console, ffmpegPath, inputArgs);
        session.onClose(reason => {
            this.console.log(`[intercom] session closed: ${reason}`);
            if (this.intercomSession === session) {
                this.intercomSession = undefined;
            }
        });

        try {
            await session.start();
            this.intercomSession = session;
        } catch (err) {
            this.console.error('[intercom] start failed:', err);
            await session.stop('start-failed');
            throw err;
        }
    }

    // ---------- Test tone (diagnostic) ----------

    async stopIntercom(): Promise<void> {
        const session = this.intercomSession;
        this.intercomSession = undefined;
        if (session) {
            await session.stop('stopIntercom');
        }
    }

    // ---------- Intercom (two-way audio) ----------

    private buildRtspUrl(channelId: ChannelId): string {
        const host = this.storage.getItem('host') || '';
        const port = this.storage.getItem('rtspPort') || '8554';
        const user = encodeURIComponent(this.storage.getItem('username') || '');
        const pass = encodeURIComponent(this.storage.getItem('password') || '');
        if (!host) {
            throw new Error('Camera host is not configured. Open the camera settings and set the IP Address.');
        }
        const auth = user ? `${user}:${pass}@` : '';
        return `rtsp://${auth}${host}:${port}/${channelId}`;
    }

    private async playTestTone(): Promise<void> {
        const host = (this.storage.getItem('host') || '').trim();
        if (!host) {
            this.console.error('[tone] camera host is not set');
            return;
        }

        if (this.intercomSession) {
            await this.intercomSession.stop('test-tone-start');
            this.intercomSession = undefined;
        }

        const ffmpegPath = await mediaManager.getFFmpegPath();
        // -re paces lavfi at real time; without it ffmpeg blasts all 3 seconds
        // of AAC frames in milliseconds and the camera's jitter buffer may drop
        // them or play them at >100x speed.
        const inputArgs = ['-re', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3'];

        const session = new IntercomSession(host, this.console, ffmpegPath, inputArgs);
        session.onClose(reason => {
            this.console.log(`[tone] session closed: ${reason}`);
            if (this.intercomSession === session) {
                this.intercomSession = undefined;
            }
        });

        this.console.log('[tone] starting 3s 440Hz test tone');
        try {
            await session.start();
            this.intercomSession = session;
        } catch (err) {
            this.console.error('[tone] failed to start:', err);
            await session.stop('tone-start-failed');
        }
    }

    // ---------- Internal ----------

    /**
     * Open a raw TCP session to the camera and run the START/STOP_VOICE handshake
     * without any audio pipeline. Logs every byte so we can confirm G410
     * protocol compatibility with the G400 reference without needing the Scrypted
     * talkback UI.
     */
    private async probeIntercom(): Promise<void> {
        const host = (this.storage.getItem('host') || '').trim();
        if (!host) {
            this.console.error('[probe] camera host is not set');
            return;
        }

        this.console.log(`[probe] connecting to ${host}:54324 ...`);
        const sock = new net.Socket();
        sock.setNoDelay(true);

        const sessionTs = BigInt(Date.now());
        let acked = false;

        const cleanup = (reason: string) => {
            try {
                if (!sock.destroyed) {
                    sock.write(buildPacket(TYPE_STOP_VOICE, sessionTs));
                    sock.destroy();
                }
            } catch {
                // ignore
            }
            this.console.log(`[probe] ended (${reason}). acked=${acked}`);
        };

        sock.on('data', (chunk: Buffer) => {
            this.console.log(`[probe] <- ${chunk.length}B hex=${chunk.toString('hex')}`);
            const parsed = parsePacket(chunk);
            if (parsed) {
                this.console.log(`[probe]    parsed: ${parsed.typeName} value=${parsed.value}`);
                if (parsed.type === TYPE_ACK && Number(parsed.value) === 0) {
                    acked = true;
                    cleanup('ack-received');
                } else if (parsed.type === TYPE_ACK) {
                    cleanup(`ack-nonzero (${parsed.value})`);
                }
            } else {
                this.console.log('[probe]    parsed: invalid / unrecognized packet');
            }
        });

        sock.on('error', (err: Error) => {
            this.console.error('[probe] socket error:', err.message);
        });

        sock.on('close', () => {
            if (!acked) this.console.log('[probe] socket closed without ACK');
        });

        await new Promise<void>(resolve => {
            const timeout = setTimeout(() => {
                this.console.warn('[probe] connect timed out');
                cleanup('connect-timeout');
                resolve();
            }, 3000);

            sock.connect(54324, host, () => {
                clearTimeout(timeout);
                const pkt = buildPacket(TYPE_START_VOICE, sessionTs);
                this.console.log(`[probe] connected. sending START_VOICE ${pkt.length}B hex=${pkt.toString('hex')}`);
                sock.write(pkt);

                // Give the camera up to 3s to respond; then close regardless.
                setTimeout(() => {
                    if (!sock.destroyed) cleanup('no-ack-timeout');
                    resolve();
                }, 3000);
            });
        });
    }

    private resolveChannelId(key: string, fallback: ChannelId): ChannelId {
        const raw = (this.storage.getItem(key) || fallback) as ChannelId;
        return raw in CHANNELS ? raw : fallback;
    }
}
