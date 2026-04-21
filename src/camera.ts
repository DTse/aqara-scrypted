import sdk, {
    Setting,
    Intercom,
    Settings,
    HttpRequest,
    FFmpegInput,
    MediaObject,
    VideoCamera,
    HttpResponse,
    BinarySensor,
    SettingValue,
    ScryptedInterface,
    ScryptedMimeTypes,
    ScryptedDeviceBase,
    HttpRequestHandler,
    RequestMediaStreamOptions,
    ResponseMediaStreamOptions
} from '@scrypted/sdk';
import net from 'node:net';
import { randomBytes } from 'node:crypto';

import { IntercomSession } from './intercom-session';
import { TYPE_ACK, buildPacket, parsePacket, TYPE_STOP_VOICE, TYPE_START_VOICE } from './protocol';

import { ChannelId, buildRtspUrl, resolveChannel, parseRingEndpoint, parseIntercomVolume, timingSafeStringEqual } from './helpers';

const { mediaManager, endpointManager } = sdk;

const CONTROL_PORT = 54324;
const DOORBELL_RESET_MS = 10_000;
const PROBE_ACK_TIMEOUT_MS = 3000;
const PROBE_CONNECT_TIMEOUT_MS = 3000;

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

class AqaraCamera extends ScryptedDeviceBase implements BinarySensor, HttpRequestHandler, Intercom, Settings, VideoCamera {
    private doorbellResetTimer?: NodeJS.Timeout;
    private intercomSession?: IntercomSession;

    constructor(nativeId: string) {
        super(nativeId);
        this.online = true;
        // Reset any stale state on startup — a reload while the doorbell was
        // ringing would otherwise leave the sensor stuck on.
        this.binaryState = false;
    }

    /** Returns the current doorbell webhook token, creating one on first use. */
    getDoorbellToken(): string {
        const existing = this.storage.getItem('doorbellToken');
        if (existing) return existing;
        const fresh = randomBytes(16).toString('hex');
        this.storage.setItem('doorbellToken', fresh);
        return fresh;
    }

    async getSettings(): Promise<Setting[]> {
        const channelChoices = Object.keys(CHANNELS);
        const channelSummary = Object.values(CHANNELS)
            .map(c => `${c.id} = ${c.name}`)
            .join(', ');

        const webhookUrl = await this.buildDoorbellWebhookUrl().catch(err => {
            this.console.warn('Failed to build webhook URL:', err);
            return 'Error: could not build URL. Check plugin logs.';
        });

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
                readonly: true,
                value: webhookUrl,
                title: 'Webhook URL',
                key: 'doorbellWebhookUrl',
                group: 'Doorbell Ring Events',
                description:
                    "Fire a GET or POST to this URL to trigger a doorbell ring. See the plugin README for copy-paste setup recipes (Home Assistant, Apple Shortcuts, curl). Aqara's LAN protocol doesn't expose press events directly — you configure Aqara Home → Matter → Scene and Signal Sync once, then have your Matter controller call this URL."
            },
            {
                type: 'button',
                key: 'testDoorbell',
                title: 'Send Test Trigger',
                group: 'Doorbell Ring Events',
                description:
                    'Fires the BinarySensor now, as if the webhook were called. Use to verify HomeKit/NVR see the ring before you set up the Matter side.'
            },
            {
                type: 'button',
                title: 'Regenerate Token',
                group: 'Doorbell Ring Events',
                key: 'regenerateDoorbellToken',
                description:
                    'Invalidates the current webhook URL and generates a new one. Anyone with the old URL will no longer be able to trigger the doorbell.'
            },
            {
                type: 'button',
                key: 'probeIntercom',
                group: 'Intercom (diagnostic)',
                title: 'Test Intercom Connection',
                description:
                    'Opens a TCP session to the camera on port 54324, sends START_VOICE, logs the response, then closes. Use to verify protocol compatibility before trying real talkback.'
            },
            {
                type: 'button',
                key: 'testTone',
                title: 'Play Test Tone (3s)',
                group: 'Intercom (diagnostic)',
                description:
                    "Runs the full intercom pipeline (TCP session + UDP RTP + ffmpeg AAC) by streaming a 3-second 440Hz sine wave to the camera's speaker. Listen to the camera — if you hear a beep, 2-way audio works."
            },
            {
                type: 'number',
                key: 'intercomVolume',
                title: 'Intercom Volume',
                group: 'Intercom (diagnostic)',
                value: this.storage.getItem('intercomVolume') || '2.5',
                description:
                    'Volume multiplier applied to outgoing talkback audio. 1.0 = original, 2.0 = ~2× louder, 3.0 = ~3× louder. Above ~5.0 you will get clipping/distortion. Changes apply to the next talkback session.'
            }
        ];
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        const requestedId = (options?.id as ChannelId) || undefined;
        const mainId = this.resolveChannelId('mainChannel', 'ch1');
        const channelId = requestedId && Object.hasOwn(CHANNELS, requestedId) ? requestedId : mainId;

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

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        const parsed = parseRingEndpoint(request.url);
        if (!parsed) {
            response.send('Not Found', { code: 404 });
            return;
        }

        if (!timingSafeStringEqual(parsed.token, this.getDoorbellToken())) {
            this.console.warn('[doorbell] webhook hit with invalid token');
            response.send('Unauthorized', { code: 401 });
            return;
        }

        this.triggerDoorbell();
        response.send('ok', { code: 200, headers: { 'content-type': 'text/plain' } });
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        if (key === 'probeIntercom') {
            await this.probeIntercom();
            return;
        }
        if (key === 'testTone') {
            await this.playTestTone();
            return;
        }
        if (key === 'testDoorbell') {
            this.triggerDoorbell();
            return;
        }
        if (key === 'regenerateDoorbellToken') {
            this.storage.setItem('doorbellToken', randomBytes(16).toString('hex'));
            this.console.log('[doorbell] token regenerated; previous webhook URL is no longer valid');
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            return;
        }
        if (key === 'doorbellWebhookUrl') {
            // Read-only; ignore writes.
            return;
        }
        if (key === 'mainChannel' || key === 'subChannel') {
            const id = String(value).trim() as ChannelId;
            if (!Object.hasOwn(CHANNELS, id)) {
                throw new Error(`Unknown channel: ${value}`);
            }
            this.storage.setItem(key, id);
        } else {
            this.storage.setItem(key, value === undefined ? '' : String(value));
        }
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    release(): void {
        if (this.doorbellResetTimer) {
            clearTimeout(this.doorbellResetTimer);
            this.doorbellResetTimer = undefined;
        }
        void this.intercomSession?.stop('device-released');
    }

    async startIntercom(media: MediaObject): Promise<void> {
        this.console.log('[intercom] startIntercom called');
        const host = (this.storage.getItem('host') || '').trim();
        if (!host) {
            throw new Error('Camera host is not configured. Open settings and set the IP Address.');
        }

        // If a session is already active, tear it down first.
        if (this.intercomSession) {
            await this.intercomSession.stop('restart');
            this.intercomSession = undefined;
        }

        const { mimeType } = media as unknown as { mimeType?: string };
        this.console.log(`[intercom] media mimeType=${mimeType ?? 'unknown'}`);

        // Scrypted converts FFmpegInput media to a Buffer containing JSON;
        // parse it back to the real object.
        const rawBuf = await mediaManager.convertMediaObject<Buffer>(media, ScryptedMimeTypes.FFmpegInput);
        let ffmpegInputRaw: FFmpegInput;
        try {
            ffmpegInputRaw = JSON.parse(Buffer.from(rawBuf).toString('utf8')) as FFmpegInput;
        } catch (err) {
            this.console.error('[intercom] could not parse FFmpegInput JSON:', err);
            throw err;
        }
        this.console.log(`[intercom] FFmpegInput parsed: ${JSON.stringify(ffmpegInputRaw)}`);

        const inputArgs = ffmpegInputRaw.inputArguments;
        if (!inputArgs?.length) {
            throw new Error('MediaObject did not produce ffmpeg input arguments — cannot start intercom');
        }
        this.console.log(`[intercom] media input args: ${JSON.stringify(inputArgs)}`);

        const ffmpegPath = await mediaManager.getFFmpegPath();
        const gain = this.resolveIntercomVolume();

        const session = new IntercomSession(host, this.console, ffmpegPath, inputArgs, gain);
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

    async stopIntercom(): Promise<void> {
        const session = this.intercomSession;
        this.intercomSession = undefined;
        if (session) {
            await session.stop('stopIntercom');
        }
    }

    /**
     * Fires the BinarySensor as if the doorbell were pressed. Idempotent: if the
     * sensor is already on, extends the reset window instead of stacking timers.
     */
    triggerDoorbell(): void {
        this.console.log('[doorbell] triggered');
        this.binaryState = true;
        if (this.doorbellResetTimer) {
            clearTimeout(this.doorbellResetTimer);
        }
        this.doorbellResetTimer = setTimeout(() => {
            this.binaryState = false;
            this.doorbellResetTimer = undefined;
        }, DOORBELL_RESET_MS);
    }

    private async buildDoorbellWebhookUrl(): Promise<string> {
        const base = await endpointManager.getLocalEndpoint(this.nativeId, { public: true, insecure: true });
        const root = base.endsWith('/') ? base.slice(0, -1) : base;
        return `${root}/ring/${this.getDoorbellToken()}`;
    }

    private buildRtspUrl(channelId: ChannelId): string {
        return buildRtspUrl({
            channelId,
            host: this.storage.getItem('host') || '',
            port: this.storage.getItem('rtspPort') || '8554',
            username: this.storage.getItem('username') || undefined,
            password: this.storage.getItem('password') || undefined
        });
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

        this.console.log(`[probe] connecting to ${host}:${CONTROL_PORT} ...`);
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
            }, PROBE_CONNECT_TIMEOUT_MS);

            sock.connect(CONTROL_PORT, host, () => {
                clearTimeout(timeout);
                const pkt = buildPacket(TYPE_START_VOICE, sessionTs);
                this.console.log(`[probe] connected. sending START_VOICE ${pkt.length}B hex=${pkt.toString('hex')}`);
                sock.write(pkt);

                setTimeout(() => {
                    if (!sock.destroyed) cleanup('no-ack-timeout');
                    resolve();
                }, PROBE_ACK_TIMEOUT_MS);
            });
        });
    }

    private resolveChannelId(key: string, fallback: ChannelId): ChannelId {
        return resolveChannel(this.storage.getItem(key), fallback);
    }

    private resolveIntercomVolume(): number {
        return parseIntercomVolume(this.storage.getItem('intercomVolume'));
    }
}

export { AqaraCamera };
