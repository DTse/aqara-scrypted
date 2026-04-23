import { Buffer } from 'node:buffer';
import net, { AddressInfo } from 'node:net';

import { RtpTimestampFixer } from './rtp-timestamp-fixer';
import { type RtpCodec, parseRtpCodecs } from './sdp-parser';
import { RtspInterleavedParser } from './rtsp-interleaved-parser';

/**
 * Local RTSP relay that rewrites RTP timestamps in-flight.
 *
 * Why: the Aqara G410 ships RTP packets with timestamps set to zero (or
 * otherwise non-monotonic). Scrypted's Rebroadcast plugin consumes our
 * stream via FFmpeg, but discards any `inputArguments` we return — so we
 * can't hand-fix the timestamps via FFmpeg flags. And go2rtc's RTSP server
 * output is also a raw passthrough. The only way to give downstream a
 * clean stream is to sit between the camera and Rebroadcast and rewrite
 * timestamps at the RTP layer before they ever reach FFmpeg.
 *
 * The relay listens on a loopback port, accepts one or more clients
 * (typically Scrypted's Rebroadcast ffmpeg), opens a TCP connection to
 * the real camera for each, and proxies RTSP/interleaved-RTP bytes in
 * both directions. RTP timestamps in the camera→client direction pass
 * through a per-payload-type {@link RtpTimestampFixer}, whose clock rates
 * are learned from the DESCRIBE response's SDP.
 *
 * Credentials: the URL we return embeds the camera credentials. The
 * client uses them to build its Authorization header. We forward RTSP
 * requests verbatim — rewriting the URL client→camera would invalidate
 * any Digest hash the client computed over the Request-URI and `uri=`
 * field of the Authorization header, causing a 401 loop. Most RTSP
 * servers (including the G410) ignore the host portion of the URL and
 * route on the path alone, so `127.0.0.1:<relayPort>/<path>` is accepted.
 * Responses coming camera→client *are* rewritten: we substitute
 * `<cameraHost>:<port>` → `127.0.0.1:<relayPort>` inside headers like
 * `Content-Base` so the client's subsequent SETUP/PLAY requests keep
 * flowing through the relay instead of connecting directly to the camera.
 */

const RTP_HEADER_MIN_LEN = 12;
const RTCP_PT_MIN = 200;
const RTCP_PT_MAX = 204;

interface RtspRelayOptions {
    logger: Console;
    cameraHost: string;
    cameraPort: number;
}

class RelaySession {
    onClose?: () => void;

    private readonly cameraHostPort: string;
    private readonly clientParser = new RtspInterleavedParser();
    private closed = false;
    private readonly fixers = new Map<number, RtpTimestampFixer>();
    private readonly relayHostPort: string;

    private readonly upstream: net.Socket;
    private readonly upstreamParser = new RtspInterleavedParser();

    constructor(
        private readonly client: net.Socket,
        private readonly opts: RtspRelayOptions
    ) {
        this.cameraHostPort = `${opts.cameraHost}:${opts.cameraPort}`;
        const addr = client.localAddress ?? '127.0.0.1';
        this.relayHostPort = `${addr === '::1' ? '127.0.0.1' : addr}:${client.localPort}`;

        this.upstream = net.connect(opts.cameraPort, opts.cameraHost);

        client.on('data', (chunk: Buffer) => this.onClientData(chunk));
        client.on('close', () => this.close('client-closed'));
        client.on('error', err => this.onError('client', err));

        this.upstream.on('data', (chunk: Buffer) => this.onUpstreamData(chunk));
        this.upstream.on('close', () => this.close('upstream-closed'));
        this.upstream.on('error', err => this.onError('upstream', err));
    }

    close(reason?: string): void {
        if (this.closed) return;
        this.closed = true;
        if (reason) this.opts.logger.log(`[relay] session closing: ${reason}`);
        this.client.destroy();
        this.upstream.destroy();
        this.onClose?.();
    }

    private absorbSdpIfPresent(message: Buffer): void {
        const asText = message.toString('utf8');
        const bodyStart = asText.indexOf('\r\n\r\n');
        if (bodyStart === -1) return;
        const body = asText.slice(bodyStart + 4);
        if (!body.includes('v=0')) return;
        const codecs = parseRtpCodecs(body);
        if (codecs.size === 0) return;
        for (const [pt, codec] of codecs) {
            if (!this.fixers.has(pt)) {
                const minAdvance = minAdvanceTicksFor(codec);
                this.fixers.set(pt, new RtpTimestampFixer(codec.clockRate, minAdvance));
                this.opts.logger.log(`[relay] learned PT ${pt} ${codec.encodingName}/${codec.clockRate} (min advance ${minAdvance})`);
            }
        }
    }

    private maybeRewriteTimestamp(item: { channel: number; payload: Buffer }): { channel: number; payload: Buffer } {
        const { channel, payload } = item;
        // Odd channels are RTCP by convention (RFC 3550); skip them.
        if ((channel & 1) === 1) return item;
        if (payload.length < RTP_HEADER_MIN_LEN) return item;
        const byte1 = payload[1];
        const payloadType = byte1 & 0x7f;
        // Also skip anything that looks like a tunnelled RTCP packet.
        if (payloadType >= RTCP_PT_MIN && payloadType <= RTCP_PT_MAX) return item;
        const fixer = this.fixers.get(payloadType);
        if (!fixer) return item;
        const marker = (byte1 & 0x80) !== 0;
        const incoming = payload.readUInt32BE(4);
        const rewritten = fixer.fix(incoming, marker);
        if (rewritten !== incoming) {
            // Mutate the buffer we were handed; the parser already gave us
            // a fresh copy so this is safe.
            payload.writeUInt32BE(rewritten >>> 0, 4);
        }
        return item;
    }

    private onClientData(chunk: Buffer): void {
        for (const item of this.clientParser.feed(chunk)) {
            if (item.type === 'text') {
                // Forward RTSP requests verbatim — do NOT rewrite the URL's
                // host:port here. Digest auth signs the Request-URI and
                // includes `uri="..."` in the Authorization header; any
                // rewrite would break the hash and the camera would 401
                // forever. Most RTSP servers (including the G410) ignore
                // the host portion of the URL and route on the path alone.
                this.upstream.write(item.message);
            } else {
                // RTCP feedback from client — forward unchanged.
                this.upstream.write(reencodeBinary(item));
            }
        }
    }

    private onError(side: string, err: Error): void {
        this.opts.logger.error(`[relay] ${side} socket error:`, err.message);
        this.close(`${side}-error`);
    }

    private onUpstreamData(chunk: Buffer): void {
        for (const item of this.upstreamParser.feed(chunk)) {
            if (item.type === 'text') {
                // DESCRIBE responses carry the SDP; harvest clock rates before
                // forwarding so any RTP packets that follow get fixed.
                this.absorbSdpIfPresent(item.message);
                const rewritten = this.rewriteTextAddress(item.message, this.cameraHostPort, this.relayHostPort);
                this.client.write(rewritten);
            } else {
                this.client.write(reencodeBinary(this.maybeRewriteTimestamp(item)));
            }
        }
    }

    private rewriteTextAddress(message: Buffer, from: string, to: string): Buffer {
        if (!message.includes(from)) return message;
        // Safe to operate as UTF-8 because the prelude/header region of an
        // RTSP message is ASCII; any binary body would be inside a framed
        // interleaved packet, not here.
        const asText = message.toString('utf8');
        return Buffer.from(asText.split(from).join(to), 'utf8');
    }
}

class RtspRelay {
    get cameraHost(): string {
        return this.opts.cameraHost;
    }

    get cameraPort(): number {
        return this.opts.cameraPort;
    }

    get localPort(): number {
        return this.port;
    }

    private port = 0;

    private server?: net.Server;

    private readonly sessions = new Set<RelaySession>();

    constructor(private readonly opts: RtspRelayOptions) {}

    async start(): Promise<void> {
        if (this.server) return;
        const server = net.createServer(client => this.handleClient(client));
        server.on('error', err => this.opts.logger.error('[relay] server error:', err));
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.off('error', reject);
                resolve();
            });
        });
        this.port = (server.address() as AddressInfo).port;
        this.server = server;
        this.opts.logger.log(`[relay] listening on 127.0.0.1:${this.port} → ${this.opts.cameraHost}:${this.opts.cameraPort}`);
    }

    async stop(): Promise<void> {
        for (const session of this.sessions) session.close();
        this.sessions.clear();
        if (!this.server) return;
        await new Promise<void>(resolve => this.server!.close(() => resolve()));
        this.server = undefined;
    }

    private handleClient(client: net.Socket): void {
        const session = new RelaySession(client, this.opts);
        this.sessions.add(session);
        session.onClose = () => this.sessions.delete(session);
    }
}

const reencodeBinary = (item: { channel: number; payload: Buffer }): Buffer => {
    const hdr = Buffer.alloc(4);
    hdr[0] = 0x24;
    hdr[1] = item.channel;
    hdr.writeUInt16BE(item.payload.length, 2);
    return Buffer.concat([hdr, item.payload]);
};

/**
 * Pick a per-codec minimum RTP-timestamp advance. Audio codecs with fixed
 * frame sizes must advance by exactly samples-per-frame or downstream
 * encoders ("libopus: Queue input is backward in time") choke on packets
 * that arrive in bursts. For video we pick a conservative lower bound of
 * ~1/30s so a new-frame boundary in a burst still advances by a plausible
 * inter-frame interval.
 */
const minAdvanceTicksFor = (codec: RtpCodec): number => {
    const name = codec.encodingName.toUpperCase();
    // AAC family: AAC-LC emits 1024 samples per frame. RTP clock rate
    // equals the sample rate for audio so "1024" is the correct tick count.
    if (name === 'MPEG4-GENERIC' || name === 'MP4A-LATM' || name === 'AAC') return 1024;
    // G.711 / G.722 / G.726: 20ms packets are the common default = 160
    // samples at 8 kHz.
    if (name === 'PCMU' || name === 'PCMA' || name === 'G722' || name === 'G726') return 160;
    // Opus: 20ms packets by default = 960 samples at 48 kHz.
    if (name === 'OPUS') return 960;
    // Video / unknown: fall back to ~1/30s of the clock. With a 90 kHz
    // video clock this is 3000 ticks (~33ms), which is a safe inter-frame
    // lower bound for anything up to 30fps.
    return Math.max(1, Math.floor(codec.clockRate / 30));
};

export { RtspRelay, reencodeBinary, minAdvanceTicksFor, type RtspRelayOptions };
