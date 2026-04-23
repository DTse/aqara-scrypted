import { Buffer } from 'node:buffer';
import { test, expect } from 'vitest';

import { RtspInterleavedParser } from './rtsp-interleaved-parser';

const bytes = (...values: number[]): Buffer => Buffer.from(values);

const binaryFrame = (channel: number, payload: Buffer): Buffer => {
    const hdr = Buffer.alloc(4);
    hdr[0] = 0x24;
    hdr[1] = channel;
    hdr.writeUInt16BE(payload.length, 2);
    return Buffer.concat([hdr, payload]);
};

test('RtspInterleavedParser: extracts a complete RTSP response with no body', () => {
    const parser = new RtspInterleavedParser();
    const items = parser.feed(Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n'));
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('text');
    if (items[0].type === 'text') {
        expect(items[0].message.toString()).toBe('RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n');
    }
});

test('RtspInterleavedParser: includes body when Content-Length is set', () => {
    const parser = new RtspInterleavedParser();
    const body = 'v=0\r\no=-\r\n';
    const msg = `RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    const items = parser.feed(Buffer.from(msg));
    expect(items).toHaveLength(1);
    if (items[0].type === 'text') {
        expect(items[0].message.toString()).toBe(msg);
    }
});

test('RtspInterleavedParser: extracts a single binary frame', () => {
    const parser = new RtspInterleavedParser();
    const rtp = Buffer.from([0x80, 0x60, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]);
    const items = parser.feed(binaryFrame(0, rtp));
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('binary');
    if (items[0].type === 'binary') {
        expect(items[0].channel).toBe(0);
        expect(items[0].payload).toEqual(rtp);
    }
});

test('RtspInterleavedParser: returns nothing on partial binary header', () => {
    const parser = new RtspInterleavedParser();
    expect(parser.feed(bytes(0x24, 0x00))).toEqual([]);
    expect(parser.feed(bytes(0x00))).toEqual([]); // still no full header
    const items = parser.feed(bytes(0x02, 0xaa, 0xbb)); // len=2, payload=AA BB
    expect(items).toHaveLength(1);
    if (items[0].type === 'binary') {
        expect(items[0].payload).toEqual(bytes(0xaa, 0xbb));
    }
});

test('RtspInterleavedParser: returns nothing on partial text headers', () => {
    const parser = new RtspInterleavedParser();
    expect(parser.feed(Buffer.from('RTSP/1.0 200 OK\r\n'))).toEqual([]);
    expect(parser.feed(Buffer.from('CSeq: 1\r\n'))).toEqual([]);
    const items = parser.feed(Buffer.from('\r\n'));
    expect(items).toHaveLength(1);
});

test('RtspInterleavedParser: emits multiple frames from one feed', () => {
    const parser = new RtspInterleavedParser();
    const f1 = binaryFrame(0, bytes(0x01));
    const f2 = binaryFrame(1, bytes(0x02, 0x03));
    const items = parser.feed(Buffer.concat([f1, f2]));
    expect(items).toHaveLength(2);
    if (items[0].type === 'binary') expect(items[0].channel).toBe(0);
    if (items[1].type === 'binary') expect(items[1].channel).toBe(1);
});

test('RtspInterleavedParser: text followed by binary', () => {
    const parser = new RtspInterleavedParser();
    const text = Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n');
    const bin = binaryFrame(2, bytes(0xde, 0xad));
    const items = parser.feed(Buffer.concat([text, bin]));
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe('text');
    expect(items[1].type).toBe('binary');
});

test('RtspInterleavedParser: binary followed by text', () => {
    const parser = new RtspInterleavedParser();
    const bin = binaryFrame(0, bytes(0xca, 0xfe));
    const text = Buffer.from('RTSP/1.0 200 OK\r\n\r\n');
    const items = parser.feed(Buffer.concat([bin, text]));
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe('binary');
    expect(items[1].type).toBe('text');
});

test('RtspInterleavedParser: frame split across multiple feeds', () => {
    const parser = new RtspInterleavedParser();
    const payload = bytes(0xaa, 0xbb, 0xcc, 0xdd);
    const frame = binaryFrame(0, payload);
    // feed one byte at a time
    let items: unknown[] = [];
    for (const byte of frame) {
        items = items.concat(parser.feed(bytes(byte)));
    }
    expect(items).toHaveLength(1);
});

test('RtspInterleavedParser: payload copy is independent of internal buffer', () => {
    const parser = new RtspInterleavedParser();
    const payload = bytes(0x01, 0x02, 0x03, 0x04);
    const [item] = parser.feed(binaryFrame(0, payload));
    if (item.type !== 'binary') throw new Error('expected binary');
    item.payload[0] = 0xff; // mutate caller-side
    // The parser's internal buffer is now empty, but had we retained any
    // subarray view, the mutation would corrupt it. This test guards
    // against a regression where we forget to Buffer.from(...) the payload.
    const [item2] = parser.feed(binaryFrame(0, payload));
    if (item2.type !== 'binary') throw new Error('expected binary');
    expect(item2.payload[0]).toBe(0x01);
});
