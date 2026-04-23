import { test, expect } from 'vitest';

import { minAdvanceTicksFor } from './rtsp-relay';

test('minAdvanceTicksFor: AAC variants return 1024 samples/frame', () => {
    expect(minAdvanceTicksFor({ clockRate: 16000, encodingName: 'MPEG4-GENERIC' })).toBe(1024);
    expect(minAdvanceTicksFor({ clockRate: 44100, encodingName: 'MP4A-LATM' })).toBe(1024);
    expect(minAdvanceTicksFor({ clockRate: 16000, encodingName: 'AAC' })).toBe(1024);
    // Case-insensitive
    expect(minAdvanceTicksFor({ clockRate: 16000, encodingName: 'mpeg4-generic' })).toBe(1024);
});

test('minAdvanceTicksFor: G.711 codecs return 160 samples/frame', () => {
    expect(minAdvanceTicksFor({ clockRate: 8000, encodingName: 'PCMU' })).toBe(160);
    expect(minAdvanceTicksFor({ clockRate: 8000, encodingName: 'PCMA' })).toBe(160);
});

test('minAdvanceTicksFor: Opus returns 960 samples/frame', () => {
    expect(minAdvanceTicksFor({ clockRate: 48000, encodingName: 'OPUS' })).toBe(960);
});

test('minAdvanceTicksFor: H264 falls back to 1/30s of the clock', () => {
    // 90 kHz video / 30 = 3000 ticks (~33 ms)
    expect(minAdvanceTicksFor({ clockRate: 90000, encodingName: 'H264' })).toBe(3000);
    expect(minAdvanceTicksFor({ clockRate: 90000, encodingName: 'H265' })).toBe(3000);
});

test('minAdvanceTicksFor: unknown codec falls back to 1/30s of the clock', () => {
    expect(minAdvanceTicksFor({ clockRate: 90000, encodingName: 'VP8' })).toBe(3000);
    // Guards against ticks=0 on low clock rates
    expect(minAdvanceTicksFor({ clockRate: 10, encodingName: 'WEIRD' })).toBe(1);
});
