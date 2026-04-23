import { test, expect } from 'vitest';

import { parseRtpCodecs } from './sdp-parser';

const G410_SDP = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=Session streamed by "RTSPServer"',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    'a=tool:libavformat 60.16.100',
    'm=video 0 RTP/AVP 97',
    'a=rtpmap:97 H264/90000',
    'a=fmtp:97 packetization-mode=1',
    'a=control:streamid=0',
    'm=audio 0 RTP/AVP 96',
    'a=rtpmap:96 MPEG4-GENERIC/16000/1',
    'a=fmtp:96 profile-level-id=1',
    'a=control:streamid=1'
].join('\r\n');

test('parseRtpCodecs: extracts video and audio codecs from G410 SDP', () => {
    const map = parseRtpCodecs(G410_SDP);
    expect(map.get(97)).toEqual({ clockRate: 90000, encodingName: 'H264' });
    expect(map.get(96)).toEqual({ clockRate: 16000, encodingName: 'MPEG4-GENERIC' });
    expect(map.size).toBe(2);
});

test('parseRtpCodecs: handles LF-only line endings', () => {
    const sdp = 'v=0\nm=video 0 RTP/AVP 96\na=rtpmap:96 H264/90000\n';
    expect(parseRtpCodecs(sdp).get(96)).toEqual({ clockRate: 90000, encodingName: 'H264' });
});

test('parseRtpCodecs: audio rtpmap with channel count', () => {
    const sdp = 'a=rtpmap:100 OPUS/48000/2';
    expect(parseRtpCodecs(sdp).get(100)).toEqual({ clockRate: 48000, encodingName: 'OPUS' });
});

test('parseRtpCodecs: ignores malformed rtpmap lines', () => {
    const sdp = [
        'a=rtpmap:not-a-number H264/90000',
        'a=rtpmap:96 H264/not-a-rate',
        'a=rtpmap:96',
        'a=fmtp:96 blah',
        'a=rtpmap:97 AAC/16000'
    ].join('\r\n');
    const map = parseRtpCodecs(sdp);
    expect(map.size).toBe(1);
    expect(map.get(97)).toEqual({ clockRate: 16000, encodingName: 'AAC' });
});

test('parseRtpCodecs: empty SDP returns empty map', () => {
    expect(parseRtpCodecs('').size).toBe(0);
});

test('parseRtpCodecs: rejects out-of-range payload types', () => {
    const sdp = [
        'a=rtpmap:200 H264/90000', // PT > 127
        'a=rtpmap:-1 H264/90000', // negative
        'a=rtpmap:127 H264/90000' // boundary (allowed)
    ].join('\r\n');
    const map = parseRtpCodecs(sdp);
    expect(map.get(127)?.clockRate).toBe(90000);
    expect(map.has(200)).toBe(false);
});

test('parseRtpCodecs: rejects zero or negative clock rate', () => {
    const sdp = 'a=rtpmap:96 H264/0\r\na=rtpmap:97 AAC/-5';
    expect(parseRtpCodecs(sdp).size).toBe(0);
});
