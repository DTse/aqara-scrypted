import { test, expect } from 'vitest';

import { discoverE1, matchE1Service } from './e1-discovery';

const SERVICE = { port: 39694, addresses: ['::1', '192.0.2.5'], txt: { id: 'lumi1.54ef4486d891' } };
const TARGET = { did: '', host: '192.0.2.5' };

test('matchE1Service: matches IP initially and DID after an address change', () => {
    expect(matchE1Service(SERVICE, TARGET)).toEqual({ port: 39694, host: '192.0.2.5', did: SERVICE.txt.id });
    expect(matchE1Service(SERVICE, { host: '192.0.2.99', did: SERVICE.txt.id })?.host).toBe('192.0.2.5');
    expect(matchE1Service({ ...SERVICE, port: 42000 }, TARGET)?.port).toBe(42000);
});

test('matchE1Service: rejects unrelated cameras and unusable records', () => {
    expect(matchE1Service(SERVICE, { ...TARGET, did: 'lumi1.other' })).toBeUndefined();
    expect(matchE1Service(SERVICE, { ...TARGET, host: '192.0.2.99' })).toBeUndefined();
    for (const changes of [{ txt: {} }, { txt: { id: 'other' } }, { addresses: ['::1'] }, { port: 0 }, { port: 65536 }, { port: 1.5 }])
        expect(matchE1Service({ ...SERVICE, ...changes }, TARGET)).toBeUndefined();
});

test('discoverE1: manual override skips multicast and respects cancellation', async () => {
    const abort = new AbortController();
    expect(await discoverE1({ ...TARGET, port: 39694 }, abort.signal)).toEqual({ port: 39694, did: undefined, host: TARGET.host });
    abort.abort();
    await expect(discoverE1({ ...TARGET, port: 39694 }, abort.signal)).rejects.toThrow();
});
