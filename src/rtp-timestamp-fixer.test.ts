import { test, expect } from 'vitest';

import { type Clock, RtpTimestampFixer } from './rtp-timestamp-fixer';

/** Controllable clock for deterministic tests. */
const makeClock = (start = 1_000_000): { clock: Clock; set: (ms: number) => void; advance: (ms: number) => void } => {
    let now = start;
    return {
        clock: { now: () => now },
        set: ms => {
            now = ms;
        },
        advance: ms => {
            now += ms;
        }
    };
};

const VIDEO_RATE = 90_000;
const AUDIO_RATE = 16_000;
const AAC_FRAME_TICKS = 1024;

test('RtpTimestampFixer: first packet passes through unchanged', () => {
    const { clock } = makeClock();
    const fixer = new RtpTimestampFixer(VIDEO_RATE, 1, clock);
    expect(fixer.fix(12345, false)).toBe(12345);
});

test('RtpTimestampFixer: broken audio stream with zero timestamps advances by frame size in steady state', () => {
    const { clock, advance } = makeClock();
    const fixer = new RtpTimestampFixer(AUDIO_RATE, AAC_FRAME_TICKS, clock);

    // Simulate G410: every audio packet has timestamp=0, marker=1
    const first = fixer.fix(0, true);
    advance(64); // ~1024 samples at 16 kHz
    const second = fixer.fix(0, true);
    advance(64);
    const third = fixer.fix(0, true);

    expect(first).toBe(0);
    expect(second - first).toBe(1024);
    expect(third - second).toBe(1024);
});

test('RtpTimestampFixer: audio burst uses minAdvanceTicks not wall-clock', () => {
    // Regression: before minAdvanceTicks, an AAC burst at T=0 would output
    // timestamps [0, 1, 2, ...] because wall-clock delta is 0, which caused
    // downstream libopus to report "Queue input is backward in time".
    const { clock } = makeClock();
    const fixer = new RtpTimestampFixer(AUDIO_RATE, AAC_FRAME_TICKS, clock);

    const outputs = [];
    for (let i = 0; i < 5; i += 1) {
        outputs.push(fixer.fix(0, true));
    }

    expect(outputs).toEqual([0, 1024, 2048, 3072, 4096]);
});

test('RtpTimestampFixer: wall-clock wins when it outruns minAdvance', () => {
    // If the real elapsed time exceeds the min-frame interval, honour the
    // real timing — a paused/silent stretch shouldn't collapse to
    // minAdvance-only.
    const { clock, advance } = makeClock();
    const fixer = new RtpTimestampFixer(AUDIO_RATE, AAC_FRAME_TICKS, clock);

    fixer.fix(0, true);
    advance(1000); // 1 second = 16000 ticks
    const second = fixer.fix(0, true);

    expect(second).toBe(16000);
});

test('RtpTimestampFixer: video frame spanning multiple packets shares one output timestamp', () => {
    const { clock } = makeClock();
    const fixer = new RtpTimestampFixer(VIDEO_RATE, 1, clock);

    // Frame 1: 3 packets, marker set only on the last
    const p1 = fixer.fix(100000, false);
    const p2 = fixer.fix(100000, false);
    const p3 = fixer.fix(100000, true);

    expect(p1).toBe(100000);
    expect(p2).toBe(100000);
    expect(p3).toBe(100000);
});

test('RtpTimestampFixer: new frame after marker bumps output timestamp', () => {
    const { clock, advance } = makeClock();
    const fixer = new RtpTimestampFixer(VIDEO_RATE, 1, clock);

    fixer.fix(0, true); // first packet, marker set = end of first frame
    advance(50); // 50 ms = one frame at 20 fps
    const frame2 = fixer.fix(0, true);

    // 50 ms at 90 kHz = 4500 ticks (wall-clock wins over min advance of 1)
    expect(frame2).toBe(4500);
});

test('RtpTimestampFixer: working stream with valid timestamps stays monotonic', () => {
    const { clock, advance } = makeClock();
    const fixer = new RtpTimestampFixer(VIDEO_RATE, 1, clock);

    const out1 = fixer.fix(900000, true);
    advance(50);
    const out2 = fixer.fix(904500, true);
    advance(50);
    const out3 = fixer.fix(909000, true);

    expect(out1).toBe(900000);
    expect(out2).toBe(904500);
    expect(out3).toBe(909000);
});

test('RtpTimestampFixer: monotonic even when wall clock briefly regresses', () => {
    const { set, clock } = makeClock(1_000_000);
    const fixer = new RtpTimestampFixer(VIDEO_RATE, 1, clock);

    fixer.fix(0, true);
    set(1_000_100); // +100 ms
    const t2 = fixer.fix(0, true);
    set(1_000_050); // clock regresses 50 ms
    const t3 = fixer.fix(0, true);

    expect(t2).toBeGreaterThan(0);
    expect(t3).toBeGreaterThan(t2); // never regresses
});

test('RtpTimestampFixer: same-frame detection via unchanged incoming timestamp', () => {
    // Some cameras never set the marker bit. Fall back to detecting new
    // frames by a change in the incoming timestamp.
    const { clock, advance } = makeClock();
    const fixer = new RtpTimestampFixer(VIDEO_RATE, 1, clock);

    const a = fixer.fix(1000, false); // first
    const b = fixer.fix(1000, false); // same frame, marker still 0
    advance(50);
    const c = fixer.fix(5500, false); // new frame (ts changed), marker 0

    expect(a).toBe(b);
    expect(c).toBeGreaterThan(b);
});

test('RtpTimestampFixer: per-track clock rate respected', () => {
    const { clock, advance } = makeClock();
    const videoFixer = new RtpTimestampFixer(VIDEO_RATE, 1, clock);
    const audioFixer = new RtpTimestampFixer(AUDIO_RATE, AAC_FRAME_TICKS, clock);

    videoFixer.fix(0, true);
    audioFixer.fix(0, true);
    advance(1000); // 1 second
    const videoOut = videoFixer.fix(0, true);
    const audioOut = audioFixer.fix(0, true);

    expect(videoOut).toBe(90_000); // 1 s at 90 kHz
    expect(audioOut).toBe(16_000); // 1 s at 16 kHz
});

test('RtpTimestampFixer: treats input as unsigned 32-bit', () => {
    const { clock } = makeClock();
    const fixer = new RtpTimestampFixer(VIDEO_RATE, 1, clock);

    // Simulate a camera that sends a high-bit-set timestamp (some do)
    const high = 0xfffffff0;
    expect(fixer.fix(high, true)).toBe(high);
});
