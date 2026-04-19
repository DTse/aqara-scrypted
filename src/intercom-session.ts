import net from 'node:net';
import dgram from 'node:dgram';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';

import {
    TYPE_ACK,
    buildPacket,
    parsePacket,
    ParsedPacket,
    buildRtpHeader,
    TYPE_HEARTBEAT,
    TYPE_STOP_VOICE,
    RTP_PAYLOAD_TYPE,
    TYPE_START_VOICE,
    extractAdtsFrames
} from './protocol';

const CONTROL_PORT = 54324;
const AUDIO_PORT = 54323;
const CONNECT_TIMEOUT_MS = 3000;
const ACK_TIMEOUT_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_MAX_FAILURES = 3;

/**
 * Aqara talkback session.
 *
 * Lifecycle:
 *   1. TCP connect to camera:54324
 *   2. Send START_VOICE, wait for ACK(0)
 *   3. Open UDP socket, spawn ffmpeg AAC-ADTS encoder
 *   4. Pipe ffmpeg stdout → ADTS parser → RTP → UDP camera:54323
 *   5. Heartbeat every 5s on TCP
 *   6. On stop(): STOP_VOICE, kill ffmpeg, close sockets
 */
export class IntercomSession {
    /**
     * Stream audio into the ffmpeg encoder. Returns the writable stream so the
     * caller can pipe a MediaObject-sourced ffmpeg output into it.
     */
    get audioInput(): NodeJS.WritableStream | undefined {
        return this.ffmpegProc?.stdin;
    }
    private ackRejecter?: (err: Error) => void;
    private ackResolver?: (p: ParsedPacket) => void;
    private ffmpegProc?: ChildProcessWithoutNullStreams;
    private heartbeatFailures = 0;
    private heartbeatTimer?: NodeJS.Timeout;
    private onCloseCallback?: (reason: string) => void;
    private seqNum = 0;
    private readonly sessionTs: bigint;
    private readonly ssrc: number;
    private stdoutBuffer = Buffer.alloc(0);
    private stopped = false;
    private tcpBuffer = Buffer.alloc(0);
    private tcpSocket?: net.Socket;

    private udpSocket?: dgram.Socket;

    constructor(
        private readonly cameraIp: string,
        private readonly logger: Console,
        private readonly ffmpegPath: string,
        private readonly ffmpegInputArgs: string[]
    ) {
        this.sessionTs = BigInt(Date.now());
        // SSRC must be non-zero, 32-bit. Node's Math.random is fine here — this
        // is a unique stream identifier, not cryptographic.
        this.ssrc = Math.trunc(Math.floor(Math.random() * 0x7fffffff) + 1);
    }

    onClose(cb: (reason: string) => void): void {
        this.onCloseCallback = cb;
    }

    async start(): Promise<void> {
        this.logger.log(`[intercom] starting session to ${this.cameraIp}:${CONTROL_PORT} (ssrc=${this.ssrc >>> 0}, ts=${this.sessionTs})`);

        await this.connectTcp();
        await this.sendAndAwaitAck(TYPE_START_VOICE, this.sessionTs);
        this.logger.log('[intercom] voice session established');

        this.openUdp();
        this.spawnFfmpeg();
        this.startHeartbeat();
    }

    async stop(reason = 'user'): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        this.logger.log(`[intercom] stopping (${reason})`);

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }

        if (this.ffmpegProc) {
            try {
                this.ffmpegProc.stdin.end();
            } catch {
                // ignore
            }
            try {
                this.ffmpegProc.kill('SIGKILL');
            } catch {
                // ignore
            }
            this.ffmpegProc = undefined;
        }

        if (this.tcpSocket && !this.tcpSocket.destroyed) {
            try {
                this.tcpSocket.write(buildPacket(TYPE_STOP_VOICE, this.sessionTs));
            } catch {
                // ignore
            }
            this.tcpSocket.destroy();
            this.tcpSocket = undefined;
        }

        if (this.udpSocket) {
            try {
                this.udpSocket.close();
            } catch {
                // ignore
            }
            this.udpSocket = undefined;
        }

        this.onCloseCallback?.(reason);
    }

    // ---------- TCP ----------

    private connectTcp(): Promise<void> {
        return new Promise((resolve, reject) => {
            const sock = new net.Socket();
            sock.setNoDelay(true);

            const timeout = setTimeout(() => {
                sock.destroy();
                reject(new Error(`TCP connect to ${this.cameraIp}:${CONTROL_PORT} timed out after ${CONNECT_TIMEOUT_MS}ms`));
            }, CONNECT_TIMEOUT_MS);

            sock.once('error', err => {
                clearTimeout(timeout);
                reject(err);
            });

            sock.once('connect', () => {
                clearTimeout(timeout);
                this.tcpSocket = sock;
                sock.on('data', chunk => this.handleTcpData(chunk));
                sock.on('close', () => {
                    if (!this.stopped) {
                        this.logger.warn('[intercom] TCP socket closed unexpectedly');
                        void this.stop('tcp-closed');
                    }
                });
                sock.on('error', err => {
                    this.logger.error('[intercom] TCP socket error:', err);
                    if (!this.stopped) void this.stop('tcp-error');
                });
                resolve();
            });

            sock.connect(CONTROL_PORT, this.cameraIp);
        });
    }

    private handleAacData(chunk: Buffer): void {
        this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
        const { frames, remainder } = extractAdtsFrames(this.stdoutBuffer);
        this.stdoutBuffer = Buffer.from(remainder);
        for (const frame of frames) {
            this.sendAacFrame(frame);
        }
    }

    private handleTcpData(chunk: Buffer): void {
        this.tcpBuffer = Buffer.concat([this.tcpBuffer, chunk]);
        while (this.tcpBuffer.length >= 8) {
            const parsed = parsePacket(this.tcpBuffer);
            if (!parsed) {
                // Advance one byte to resync past junk.
                this.tcpBuffer = this.tcpBuffer.subarray(1);
                continue;
            }
            // Determine full packet length and consume it.
            const payloadLen = this.tcpBuffer.readUInt16BE(3);
            const totalLen = 5 + payloadLen + 2;
            this.tcpBuffer = this.tcpBuffer.subarray(totalLen);

            this.logger.log(`[intercom] <- ${parsed.typeName} value=${parsed.value}`);

            if (parsed.type === TYPE_ACK && this.ackResolver) {
                const resolver = this.ackResolver;
                this.ackResolver = undefined;
                this.ackRejecter = undefined;
                resolver(parsed);
            }
        }
    }

    private openUdp(): void {
        this.udpSocket = dgram.createSocket('udp4');
        this.udpSocket.on('error', err => {
            this.logger.error('[intercom] UDP socket error:', err);
            if (!this.stopped) void this.stop('udp-error');
        });
    }

    // ---------- UDP + audio ----------

    private sendAacFrame(frame: Buffer): void {
        if (!this.udpSocket || this.stopped) return;
        // 1024 samples per AAC-LC frame at 16kHz.
        const ts = this.seqNum * 1024;
        const header = buildRtpHeader(RTP_PAYLOAD_TYPE, this.seqNum, ts, this.ssrc);
        this.seqNum = (this.seqNum + 1) & 0xffff;
        const packet = Buffer.concat([header, frame]);
        this.udpSocket.send(packet, AUDIO_PORT, this.cameraIp, err => {
            if (err) {
                this.logger.warn('[intercom] UDP send error:', err);
            }
        });
    }

    private async sendAndAwaitAck(type: number, value: bigint | number): Promise<ParsedPacket> {
        if (!this.tcpSocket || this.tcpSocket.destroyed) {
            throw new Error('TCP socket not open');
        }

        const packet = buildPacket(type, value);
        this.logger.log(`[intercom] -> type=${type} len=${packet.length}B hex=${packet.toString('hex')}`);

        const ackPromise = new Promise<ParsedPacket>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.ackResolver = undefined;
                this.ackRejecter = undefined;
                reject(new Error(`No ACK received within ${ACK_TIMEOUT_MS}ms for type=${type}`));
            }, ACK_TIMEOUT_MS);
            this.ackResolver = p => {
                clearTimeout(timeout);
                resolve(p);
            };
            this.ackRejecter = err => {
                clearTimeout(timeout);
                reject(err);
            };
        });

        this.tcpSocket.write(packet);
        const parsed = await ackPromise;

        if (parsed.type !== TYPE_ACK || Number(parsed.value) !== 0) {
            throw new Error(`Voice session rejected: type=${parsed.typeName} value=${parsed.value}`);
        }
        return parsed;
    }

    private spawnFfmpeg(): void {
        // Build ADTS-encoder args. The input description is provided by the
        // caller (they got it from Scrypted's mediaManager).
        const args = [
            '-hide_banner',
            '-loglevel',
            'error',
            '-fflags',
            'nobuffer',
            '-flags',
            'low_delay',
            ...this.ffmpegInputArgs,
            '-c:a',
            'aac',
            '-profile:a',
            'aac_low',
            '-b:a',
            '32k',
            '-ar',
            '16000',
            '-ac',
            '1',
            '-f',
            'adts',
            'pipe:1'
        ];

        this.logger.log(`[intercom] spawning ffmpeg: ${this.ffmpegPath} ${args.join(' ')}`);

        const proc = spawn(this.ffmpegPath, args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });
        this.ffmpegProc = proc;

        proc.stdout.on('data', (chunk: Buffer) => this.handleAacData(chunk));

        proc.stderr.on('data', (chunk: Buffer) => {
            const msg = chunk.toString().trim();
            if (msg) this.logger.log(`[intercom][ffmpeg] ${msg}`);
        });

        proc.on('exit', (code, signal) => {
            this.logger.log(`[intercom] ffmpeg exited code=${code} signal=${signal}`);
            if (!this.stopped) void this.stop('ffmpeg-exited');
        });

        proc.on('error', err => {
            this.logger.error('[intercom] ffmpeg spawn error:', err);
            if (!this.stopped) void this.stop('ffmpeg-error');
        });
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(async () => {
            if (this.stopped) return;
            try {
                if (!this.tcpSocket || this.tcpSocket.destroyed) {
                    throw new Error('TCP socket not open');
                }
                const packet = buildPacket(TYPE_HEARTBEAT, this.sessionTs);
                this.tcpSocket.write(packet);
                // We don't strictly await the ACK here — handleTcpData logs it when
                // it arrives. If ACKs stop coming the socket will close on the next
                // heartbeat round trip via the OS.
                this.heartbeatFailures = 0;
            } catch (err) {
                this.heartbeatFailures++;
                this.logger.warn(`[intercom] heartbeat failure ${this.heartbeatFailures}/${HEARTBEAT_MAX_FAILURES}:`, err);
                if (this.heartbeatFailures >= HEARTBEAT_MAX_FAILURES) {
                    void this.stop('heartbeat-failed');
                }
            }
        }, HEARTBEAT_INTERVAL_MS);
    }
}
