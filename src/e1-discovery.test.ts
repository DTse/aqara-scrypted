import { once } from 'node:events';
import { Buffer } from 'node:buffer';
import createMdns from 'multicast-dns';
import { createSocket } from 'node:dgram';
import { test, expect, onTestFinished } from 'vitest';

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

test('discoverE1: rejects a failed mDNS bind through the discovery promise', async () => {
    const blocker = createSocket('udp4');
    await new Promise<void>((resolve, reject) => {
        blocker.once('error', reject);
        blocker.bind(0, '127.0.0.1', resolve);
    });
    onTestFinished(() => {
        blocker.close();
    });
    const makeMdns = () =>
        createMdns({
            multicast: false,
            reuseAddr: false,
            bind: '127.0.0.1',
            port: blocker.address().port
        });
    await expect(discoverE1(TARGET, new AbortController().signal, makeMdns)).rejects.toThrow(/bind EADDRINUSE/);
});

test('discoverE1: public Bonjour browser resolves the camera and closes its transport', async () => {
    const socket = createSocket('udp4');
    await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, '127.0.0.1', resolve);
    });
    const closed = once(socket, 'close');
    const mdns = createMdns({ socket, bind: false, ip: '127.0.0.1', multicast: false, port: socket.address().port });
    const result = discoverE1({ did: '', host: '127.0.0.1' }, new AbortController().signal, () => mdns);
    const name = 'Camera-E1._aqara-setup._tcp.local';
    mdns.emit(
        'response',
        {
            id: 0,
            flags: 0,
            questions: [],
            authorities: [],
            type: 'response',
            answers: [{ ttl: 120, data: name, type: 'PTR', name: '_aqara-setup._tcp.local' }],
            additionals: [
                { name, ttl: 120, type: 'SRV', data: { weight: 0, port: 39694, priority: 0, target: 'Camera-E1.local' } },
                { name, ttl: 120, type: 'TXT', data: [Buffer.from(`id=${SERVICE.txt.id}`)] },
                { ttl: 120, type: 'A', data: '127.0.0.1', name: 'Camera-E1.local' }
            ]
        },
        { size: 100, port: 5353, family: 'IPv4', address: '127.0.0.1' }
    );
    expect(await result).toEqual({ port: 39694, host: '127.0.0.1', did: SERVICE.txt.id });
    await closed;
    expect(mdns.listenerCount('response')).toBe(0);
});

test('discoverE1: retries a lost query and closes its transport after the reply', async () => {
    const socket = createSocket('udp4');
    await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, '127.0.0.1', resolve);
    });
    const closed = once(socket, 'close');
    const mdns = createMdns({ socket, bind: false, ip: '127.0.0.1', multicast: false, port: socket.address().port });
    onTestFinished(() => mdns.destroy());
    let queries = 0;
    const name = 'Camera-E1._aqara-setup._tcp.local';
    mdns.on('query', () => {
        if (++queries < 2) return;
        mdns.respond({
            answers: [{ ttl: 120, data: name, type: 'PTR', name: '_aqara-setup._tcp.local' }],
            additionals: [
                { name, ttl: 120, type: 'SRV', data: { weight: 0, port: 39694, priority: 0, target: 'Camera-E1.local' } },
                { name, ttl: 120, type: 'TXT', data: [Buffer.from(`id=${SERVICE.txt.id}`)] },
                { ttl: 120, type: 'A', data: '127.0.0.1', name: 'Camera-E1.local' }
            ]
        });
    });
    const result = await discoverE1({ did: '', host: '127.0.0.1' }, new AbortController().signal, () => mdns);
    expect(result).toEqual({ port: 39694, host: '127.0.0.1', did: SERVICE.txt.id });
    expect(queries).toBeGreaterThanOrEqual(2);
    await closed;
    expect(mdns.listenerCount('response')).toBe(0);
});
