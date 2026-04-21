import { Buffer } from 'node:buffer';
import { test, expect } from 'vitest';

import {
    MAGIC,
    TYPE_ACK,
    buildPacket,
    crc16Kermit,
    parsePacket,
    buildRtpHeader,
    TYPE_HEARTBEAT,
    TYPE_STOP_VOICE,
    RTP_PAYLOAD_TYPE,
    TYPE_START_VOICE,
    extractAdtsFrames
} from './protocol';

// ==============================
// crc16Kermit
// ==============================

test('crc16Kermit: empty input is the init value inverted', () => {
    // init=0xFFFF, no bytes processed, final XOR 0xFFFF → 0x0000.
    expect(crc16Kermit(Buffer.alloc(0))).toBe(0x0000);
});

test('crc16Kermit: known Aqara ACK CRC', () => {
    // From captured camera ACK packet `feef02000100dc70`: CRC is computed over
    // bytes 0x02 0x00 0x01 0x00 and equals 0xdc70.
    const crcInput = Buffer.from([0x02, 0x00, 0x01, 0x00]);
    expect(crc16Kermit(crcInput)).toBe(0xdc70);
});

test('crc16Kermit: deterministic', () => {
    const a = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(crc16Kermit(a)).toBe(crc16Kermit(a));
});

test('crc16Kermit: different inputs produce different CRCs', () => {
    expect(crc16Kermit(Buffer.from([0x00]))).not.toBe(crc16Kermit(Buffer.from([0x01])));
});

// ==============================
// buildPacket
// ==============================

test('buildPacket: ACK is 8 bytes with single-byte payload', () => {
    const pkt = buildPacket(TYPE_ACK, 0);
    // Magic(2) + Type(1) + Len(2) + Payload(1) + CRC(2) = 8
    expect(pkt.length).toBe(8);
    expect(pkt.toString('hex')).toBe('feef02000100dc70');
});

test('buildPacket: ACK truncates value to low byte', () => {
    const pkt = buildPacket(TYPE_ACK, 0x1ff);
    expect(pkt[5]).toBe(0xff);
});

test('buildPacket: START_VOICE is 15 bytes', () => {
    // Magic(2) + Type(1) + Len(2) + Payload(8) + CRC(2) = 15
    const pkt = buildPacket(TYPE_START_VOICE, 0n);
    expect(pkt.length).toBe(15);
    expect(pkt[0]).toBe(MAGIC[0]);
    expect(pkt[1]).toBe(MAGIC[1]);
    expect(pkt[2]).toBe(TYPE_START_VOICE);
    expect(pkt.readUInt16BE(3)).toBe(8);
});

test('buildPacket: timestamp is big-endian', () => {
    const pkt = buildPacket(TYPE_START_VOICE, 0x0102030405060708n);
    expect(pkt.subarray(5, 13).toString('hex')).toBe('0102030405060708');
});

test('buildPacket: accepts number or bigint for non-ACK types', () => {
    expect(buildPacket(TYPE_HEARTBEAT, 12345)).toEqual(buildPacket(TYPE_HEARTBEAT, 12345n));
});

test('buildPacket: CRC differs when payload differs', () => {
    const a = buildPacket(TYPE_START_VOICE, 0n);
    const b = buildPacket(TYPE_START_VOICE, 1n);
    expect(a.subarray(-2).toString('hex')).not.toBe(b.subarray(-2).toString('hex'));
});

test('buildPacket: each type produces distinct bytes', () => {
    const ts = 1_700_000_000_000n;
    const hexes = [TYPE_START_VOICE, TYPE_STOP_VOICE, TYPE_HEARTBEAT].map(t => buildPacket(t, ts).toString('hex'));
    expect(new Set(hexes).size).toBe(hexes.length);
});

// ==============================
// parsePacket
// ==============================

test('parsePacket: round-trips START_VOICE', () => {
    const ts = 1_700_000_000_000n;
    expect(parsePacket(buildPacket(TYPE_START_VOICE, ts))).toEqual({
        value: ts,
        type: TYPE_START_VOICE,
        typeName: 'START_VOICE'
    });
});

test('parsePacket: round-trips STOP_VOICE', () => {
    expect(parsePacket(buildPacket(TYPE_STOP_VOICE, 1234n))).toMatchObject({
        type: TYPE_STOP_VOICE,
        typeName: 'STOP_VOICE'
    });
});

test('parsePacket: round-trips HEARTBEAT', () => {
    expect(parsePacket(buildPacket(TYPE_HEARTBEAT, 0n))).toEqual({
        value: 0n,
        type: TYPE_HEARTBEAT,
        typeName: 'HEARTBEAT'
    });
});

test('parsePacket: ACK value is the payload byte as a number', () => {
    expect(parsePacket(Buffer.from('feef02000100dc70', 'hex'))).toEqual({
        value: 0,
        type: TYPE_ACK,
        typeName: 'ACK'
    });
});

test('parsePacket: ACK with non-zero value', () => {
    expect(parsePacket(buildPacket(TYPE_ACK, 42))).toMatchObject({ value: 42 });
});

test('parsePacket: rejects buffers shorter than 8 bytes', () => {
    expect(parsePacket(Buffer.alloc(0))).toBeNull();
    expect(parsePacket(Buffer.alloc(7))).toBeNull();
});

test('parsePacket: rejects wrong magic', () => {
    const pkt = buildPacket(TYPE_HEARTBEAT, 0n);
    pkt[0] = 0x00;
    expect(parsePacket(pkt)).toBeNull();
});

test('parsePacket: rejects unknown type (>3)', () => {
    const pkt = buildPacket(TYPE_HEARTBEAT, 0n);
    pkt[2] = 4;
    expect(parsePacket(pkt)).toBeNull();
});

test('parsePacket: rejects truncated payload', () => {
    const pkt = buildPacket(TYPE_START_VOICE, 0n);
    expect(parsePacket(pkt.subarray(0, -3))).toBeNull();
});

test('parsePacket: rejects bad CRC', () => {
    const pkt = buildPacket(TYPE_START_VOICE, 0n);
    pkt[pkt.length - 1] ^= 0xff;
    expect(parsePacket(pkt)).toBeNull();
});

test('parsePacket: accepts extra trailing bytes (framing is the caller concern)', () => {
    // parsePacket only validates the packet starting at offset 0. A longer
    // buffer containing the packet followed by garbage is still accepted —
    // stream framing (consume N bytes, re-scan) lives in IntercomSession.
    const padded = Buffer.concat([buildPacket(TYPE_HEARTBEAT, 99n), Buffer.from([0xde, 0xad, 0xbe, 0xef])]);
    expect(parsePacket(padded)).toMatchObject({ value: 99n });
});

// ==============================
// buildRtpHeader
// ==============================

test('buildRtpHeader: 12 byte header with v2 + payload type', () => {
    const hdr = buildRtpHeader(RTP_PAYLOAD_TYPE, 0, 0, 1);
    expect(hdr.length).toBe(12);
    expect(hdr[0]).toBe(0x80);
    expect(hdr[1] & 0x7f).toBe(RTP_PAYLOAD_TYPE);
});

test('buildRtpHeader: seq/ts/ssrc big-endian', () => {
    const hdr = buildRtpHeader(97, 0x1234, 0xaabbccdd, 0x11223344);
    expect(hdr.readUInt16BE(2)).toBe(0x1234);
    expect(hdr.readUInt32BE(4)).toBe(0xaabbccdd);
    expect(hdr.readUInt32BE(8)).toBe(0x11223344);
});

test('buildRtpHeader: high bit of PT is masked off', () => {
    expect(buildRtpHeader(0xff, 0, 0, 1)[1]).toBe(0x7f);
});

test('buildRtpHeader: seq wraps to 16-bit', () => {
    expect(buildRtpHeader(97, 0x1_00_01, 0, 1).readUInt16BE(2)).toBe(0x0001);
});

// ==============================
// extractAdtsFrames
// ==============================

function buildAdtsFrame(frameLen: number, filler = 0xaa): Buffer {
    if (frameLen < 7 || frameLen > 0x1fff) {
        throw new Error(`frame length ${frameLen} out of ADTS range`);
    }
    const f = Buffer.alloc(frameLen, filler);
    // Sync word 0xFFF + MPEG-4 / no CRC in lower nibble of byte 1.
    f[0] = 0xff;
    f[1] = 0xf1;
    f[2] = 0x00;
    // 13-bit frame length split across bytes 3/4/5.
    f[3] = (f[3] & ~0x03) | ((frameLen >> 11) & 0x03);
    f[4] = (frameLen >> 3) & 0xff;
    f[5] = (f[5] & ~0xe0) | ((frameLen & 0x07) << 5);
    f[6] = 0xfc;
    return f;
}

test('extractAdtsFrames: empty input → no frames, empty remainder', () => {
    const { frames, remainder } = extractAdtsFrames(Buffer.alloc(0));
    expect(frames).toHaveLength(0);
    expect(remainder.length).toBe(0);
});

test('extractAdtsFrames: single complete frame → one frame, empty remainder', () => {
    const { frames, remainder } = extractAdtsFrames(buildAdtsFrame(32));
    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(32);
    expect(remainder.length).toBe(0);
});

test('extractAdtsFrames: multiple back-to-back frames', () => {
    const data = Buffer.concat([buildAdtsFrame(16), buildAdtsFrame(24), buildAdtsFrame(20)]);
    const { frames, remainder } = extractAdtsFrames(data);
    expect(frames.map(f => f.length)).toEqual([16, 24, 20]);
    expect(remainder.length).toBe(0);
});

test('extractAdtsFrames: trailing partial frame becomes remainder', () => {
    const complete = buildAdtsFrame(16);
    const partial = buildAdtsFrame(32).subarray(0, 10);
    const { frames, remainder } = extractAdtsFrames(Buffer.concat([complete, partial]));
    expect(frames).toHaveLength(1);
    expect(remainder.length).toBe(10);
    expect(remainder[0]).toBe(0xff);
});

test('extractAdtsFrames: leading garbage is skipped until sync word', () => {
    const data = Buffer.concat([Buffer.from([0x01, 0x02, 0x03]), buildAdtsFrame(16)]);
    const { frames, remainder } = extractAdtsFrames(data);
    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(16);
    expect(remainder.length).toBe(0);
});

test('extractAdtsFrames: partial header at end becomes remainder', () => {
    const data = Buffer.concat([buildAdtsFrame(16), Buffer.from([0xff, 0xf1])]);
    const { frames, remainder } = extractAdtsFrames(data);
    expect(frames).toHaveLength(1);
    expect(remainder.length).toBe(2);
});

test('extractAdtsFrames: sync word with impossibly short frame stops scan', () => {
    // Force a frame-length of 3 bytes (below minimum 7) — the parser should
    // break rather than consume nonsensical bytes.
    const bad = Buffer.alloc(10, 0x00);
    bad[0] = 0xff;
    bad[1] = 0xf1;
    bad[4] = 0x00;
    bad[5] = 0x60;
    expect(extractAdtsFrames(bad).frames).toHaveLength(0);
});
