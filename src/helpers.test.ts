import { test, expect } from 'vitest';

import { buildRtspUrl, resolveChannel, VALID_CHANNEL_IDS, parseRingEndpoint, parseIntercomVolume, timingSafeStringEqual } from './helpers';

// ==============================
// timingSafeStringEqual
// ==============================

test('timingSafeStringEqual: equal strings → true', () => {
    expect(timingSafeStringEqual('hello', 'hello')).toBe(true);
    expect(timingSafeStringEqual('', '')).toBe(true);
});

test('timingSafeStringEqual: different strings same length → false', () => {
    expect(timingSafeStringEqual('hello', 'world')).toBe(false);
});

test('timingSafeStringEqual: different lengths → false', () => {
    expect(timingSafeStringEqual('a', 'aa')).toBe(false);
    expect(timingSafeStringEqual('', 'x')).toBe(false);
});

test('timingSafeStringEqual: non-ASCII UTF-8', () => {
    expect(timingSafeStringEqual('héllo', 'héllo')).toBe(true);
    expect(timingSafeStringEqual('héllo', 'hellо')).toBe(false); // cyrillic 'о'
});

// ==============================
// parseRingEndpoint
// ==============================

test('parseRingEndpoint: basic match', () => {
    expect(parseRingEndpoint('/ring/abc123')).toEqual({ token: 'abc123' });
});

test('parseRingEndpoint: with trailing slash', () => {
    expect(parseRingEndpoint('/ring/abc123/')).toEqual({ token: 'abc123' });
});

test('parseRingEndpoint: with query string', () => {
    expect(parseRingEndpoint('/ring/abc123?foo=bar')).toEqual({ token: 'abc123' });
});

test('parseRingEndpoint: within a longer plugin path', () => {
    expect(parseRingEndpoint('/endpoint/aqara-scrypted/public/ring/abc123')).toEqual({ token: 'abc123' });
});

test('parseRingEndpoint: accepts - and _ in token', () => {
    expect(parseRingEndpoint('/ring/a-b_c')).toEqual({ token: 'a-b_c' });
});

test('parseRingEndpoint: rejects wrong path', () => {
    expect(parseRingEndpoint('/motion/abc')).toBeNull();
    expect(parseRingEndpoint('/foo')).toBeNull();
    expect(parseRingEndpoint('/')).toBeNull();
});

test('parseRingEndpoint: rejects empty/undefined', () => {
    expect(parseRingEndpoint(undefined)).toBeNull();
    expect(parseRingEndpoint('')).toBeNull();
});

test('parseRingEndpoint: rejects extra path segments after token', () => {
    // Extra segments shouldn't accidentally match — someone might be looking
    // at a deeper path we don't serve.
    expect(parseRingEndpoint('/ring/abc/extra')).toBeNull();
});

test('parseRingEndpoint: rejects token with invalid chars', () => {
    expect(parseRingEndpoint('/ring/abc$123')).toBeNull();
    expect(parseRingEndpoint('/ring/abc 123')).toBeNull();
    expect(parseRingEndpoint('/ring/abc.123')).toBeNull();
});

// ==============================
// parseIntercomVolume
// ==============================

test('parseIntercomVolume: parses valid numbers', () => {
    expect(parseIntercomVolume('1')).toBe(1);
    expect(parseIntercomVolume('2.5')).toBe(2.5);
    expect(parseIntercomVolume('0.5')).toBe(0.5);
});

test('parseIntercomVolume: empty/null/undefined → 1', () => {
    expect(parseIntercomVolume('')).toBe(1);
    expect(parseIntercomVolume(null)).toBe(1);
    expect(parseIntercomVolume(undefined)).toBe(1);
});

test('parseIntercomVolume: garbage → 1', () => {
    expect(parseIntercomVolume('abc')).toBe(1);
    expect(parseIntercomVolume('NaN')).toBe(1);
});

test('parseIntercomVolume: zero or negative → 1', () => {
    expect(parseIntercomVolume('0')).toBe(1);
    expect(parseIntercomVolume('-1')).toBe(1);
    expect(parseIntercomVolume('-0.5')).toBe(1);
});

test('parseIntercomVolume: trailing junk is accepted (parseFloat behaviour)', () => {
    // parseFloat('3x') === 3 — we tolerate this rather than fighting parseFloat.
    expect(parseIntercomVolume('3x')).toBe(3);
});

// ==============================
// resolveChannel
// ==============================

test('resolveChannel: returns valid id verbatim', () => {
    for (const id of VALID_CHANNEL_IDS) {
        expect(resolveChannel(id, 'ch1')).toBe(id);
    }
});

test('resolveChannel: falls back when raw is null/empty', () => {
    expect(resolveChannel(null, 'ch1')).toBe('ch1');
    expect(resolveChannel(undefined, 'ch1')).toBe('ch1');
    expect(resolveChannel('', 'ch1')).toBe('ch1');
});

test('resolveChannel: falls back on unknown id', () => {
    expect(resolveChannel('ch99', 'ch2')).toBe('ch2');
    expect(resolveChannel('foo', 'ch3')).toBe('ch3');
});

// ==============================
// buildRtspUrl
// ==============================

test('buildRtspUrl: host + port + channel, no auth', () => {
    expect(
        buildRtspUrl({
            port: '8554',
            channelId: 'ch1',
            host: '192.168.1.50'
        })
    ).toBe('rtsp://192.168.1.50:8554/ch1');
});

test('buildRtspUrl: with username and password', () => {
    expect(
        buildRtspUrl({
            port: '8554',
            host: '10.0.0.1',
            channelId: 'ch2',
            username: 'user',
            password: 'pass'
        })
    ).toBe('rtsp://user:pass@10.0.0.1:8554/ch2');
});

test('buildRtspUrl: encodes special characters in credentials', () => {
    // '@' → %40, ':' → %3A, '/' → %2F, '#' → %23
    expect(
        buildRtspUrl({
            port: '8554',
            host: '10.0.0.1',
            channelId: 'ch1',
            username: 'u@s:r',
            password: 'p/ss#1'
        })
    ).toBe('rtsp://u%40s%3Ar:p%2Fss%231@10.0.0.1:8554/ch1');
});

test('buildRtspUrl: username without password still gets colon separator', () => {
    expect(
        buildRtspUrl({
            port: '8554',
            host: '10.0.0.1',
            channelId: 'ch1',
            username: 'user'
        })
    ).toBe('rtsp://user:@10.0.0.1:8554/ch1');
});

test('buildRtspUrl: password without username → no auth block', () => {
    // A password alone is meaningless; we drop auth entirely rather than emit
    // `rtsp://:pass@host` which some parsers reject.
    expect(
        buildRtspUrl({
            port: '8554',
            host: '10.0.0.1',
            channelId: 'ch1',
            password: 'pass'
        })
    ).toBe('rtsp://10.0.0.1:8554/ch1');
});

test('buildRtspUrl: throws when host missing', () => {
    expect(() =>
        buildRtspUrl({
            host: '',
            port: '8554',
            channelId: 'ch1'
        })
    ).toThrow(/Camera host is not configured/);
});
