/**
 * Minimal SDP parser. We only need per-payload-type codec info so the
 * timestamp fixer can apply the correct scaling per track; we do not
 * need the full SDP grammar.
 *
 * Relevant line format (RFC 4566 §6):
 *   a=rtpmap:<payload-type> <encoding-name>/<clock-rate>[/<channels>]
 *
 * Examples seen on the G410 (from the RTSP DESCRIBE response):
 *   a=rtpmap:96 H264/90000                   -> H.264 video, 90 kHz
 *   a=rtpmap:97 MPEG4-GENERIC/16000/1        -> AAC audio, 16 kHz mono
 */

const RTPMAP_LINE = /^a=rtpmap:(\d+)\s+([^/\s]+)\/(\d+)/;

interface RtpCodec {
    clockRate: number;
    encodingName: string;
}

/**
 * Parse an SDP blob and return a map from dynamic RTP payload type to
 * its advertised codec. Malformed lines are silently skipped — an SDP we
 * can't fully parse is not fatal; the relay will simply passthrough any
 * RTP packets whose payload type we don't recognise.
 */
const parseRtpCodecs = (sdp: string): Map<number, RtpCodec> => {
    const map = new Map<number, RtpCodec>();
    for (const rawLine of sdp.split(/\r?\n/)) {
        const line = rawLine.trim();
        const match = RTPMAP_LINE.exec(line);
        if (!match) continue;
        const payloadType = Number.parseInt(match[1], 10);
        const encodingName = match[2];
        const clockRate = Number.parseInt(match[3], 10);
        if (!Number.isFinite(payloadType) || !Number.isFinite(clockRate)) continue;
        if (payloadType < 0 || payloadType > 127) continue;
        if (clockRate <= 0) continue;
        map.set(payloadType, { clockRate, encodingName });
    }
    return map;
};

export { type RtpCodec, parseRtpCodecs };
