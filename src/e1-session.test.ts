import { createSocket } from 'node:dgram';
import { test, expect, onTestFinished } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';

import { E1Session } from './e1-session';
import { encodeE1Message, decodeE1Message } from './e1-protocol';

import type { E1Action } from './e1-protocol';

const createCamera = async (shouldAcknowledge: (action: string) => boolean = () => true, did = '') => {
    const socket = createSocket('udp4');
    const received: { time: number; action: string }[] = [];
    await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, '127.0.0.1', () => {
            socket.off('error', reject);
            resolve();
        });
    });
    socket.on('message', (data, remote) => {
        const action = decodeE1Message(data, remote.address).params?.action;
        if (!action) return;
        received.push({ action, time: Date.now() });
        if (shouldAcknowledge(action))
            socket.send(encodeE1Message({ params: { action }, cmd: 'camera.ctrl_ptz_done' }, remote.address), remote.port, remote.address);
    });
    const session = new E1Session({
        logger: { warn: () => undefined },
        getTarget: () => ({ did, host: '127.0.0.1', port: socket.address().port })
    });
    onTestFinished(async () => {
        await session.release().catch(() => undefined);
        socket.close();
    });
    return { session, received, target: { did, host: '127.0.0.1', port: socket.address().port } };
};

const waitForAction = async (received: { action: string }[], action: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (received.some(message => message.action === action)) return;
        await delay(10);
    }
    throw new Error(`Simulator did not receive ${action}`);
};

test('E1Session: sends each direction once and follows with repeated stop', async () => {
    const { session, received } = await createCamera();
    for (const action of ['up', 'down', 'left', 'right'] as E1Action[]) {
        await session.command({ action, duration: 250 });
        await delay(10);
        expect(received.filter(message => message.action === action)).toHaveLength(1);
    }
    expect(received.filter(message => message.action === 'stop').length).toBeGreaterThanOrEqual(8);
});

test('E1Session: watchdog stops on time even when direction ACK is lost', async () => {
    const { session, received } = await createCamera(action => action === 'stop');
    const result = session.command({ duration: 300, action: 'right' });
    const assertion = expect(result).rejects.toThrow(/right acknowledgement timed out/);
    await waitForAction(received, 'stop');
    expect(received.find(message => message.action === 'stop')!.time - received[0].time).toBeLessThan(650);
    await assertion;
    expect(received.filter(message => message.action === 'right')).toHaveLength(1);
    const stops = received.filter(message => message.action === 'stop');
    expect(stops).toHaveLength(2);
    expect(stops[1].time - received[0].time).toBeLessThan(900);
});

test('E1Session: explicit stop preempts an unacknowledged jog', async () => {
    const { session, received } = await createCamera(action => action === 'stop');
    const moving = session.command({ action: 'left', duration: 1000 });
    await waitForAction(received, 'left');
    const stoppedAt = Date.now();
    await session.command({ duration: 0, action: 'stop' });
    await moving;
    expect(received.find(message => message.action === 'stop')!.time - stoppedAt).toBeLessThan(250);
    expect(received.filter(message => message.action === 'left')).toHaveLength(1);
});

test('E1Session: rapid replacement drains old stops before new movement and cancels stale watchdogs', async () => {
    const { session, received } = await createCamera();
    const first = session.command({ action: 'left', duration: 1000 });
    await waitForAction(received, 'left');
    const second = session.command({ action: 'up', duration: 1000 });
    const latest = session.command({ duration: 1000, action: 'right' });
    await waitForAction(received, 'right');
    const rightAt = received.find(message => message.action === 'right')!.time;
    await Promise.all([first, second, latest]);
    expect(received.some(message => message.action === 'up')).toBe(false);
    const rightIndex = received.findIndex(message => message.action === 'right');
    const followingStops = received.slice(rightIndex + 1).filter(message => message.action === 'stop');
    expect(followingStops[0].time - rightAt).toBeGreaterThanOrEqual(900);
});

test('E1Session: release stops movement and prevents subsequent commands', async () => {
    const { session, received } = await createCamera();
    const moving = session.command({ action: 'down', duration: 1000 });
    await waitForAction(received, 'down');
    await session.release();
    await moving;
    expect(received.some(message => message.action === 'stop')).toBe(true);
    await expect(session.command({ duration: 250, action: 'right' })).rejects.toThrow(/released/);
});

test('E1Session: next operation rediscovers after a discovery failure', async () => {
    let attempts = 0;
    const session = new E1Session({
        logger: { warn: () => undefined },
        getTarget: () => ({ did: '', host: '192.0.2.1' }),
        discover: async () => {
            attempts++;
            throw new Error('Discovery unavailable');
        }
    });
    await expect(session.command({ duration: 250, action: 'right' })).rejects.toThrow(/Discovery unavailable/);
    await expect(session.command({ duration: 250, action: 'right' })).rejects.toThrow(/Discovery unavailable/);
    expect(attempts).toBe(2);
    await session.release();
});

test('E1Session: rejects another controller for the same physical camera before sending a jog', async () => {
    const { target, session, received } = await createCamera();
    const other = new E1Session({ getTarget: () => target, logger: { warn: () => undefined } });
    onTestFinished(() => other.release());
    await session.command({ duration: 250, action: 'left' });
    await expect(other.command({ duration: 250, action: 'right' })).rejects.toThrow(/already controlled/);
    expect(received.some(message => message.action === 'right')).toBe(false);
    await session.release();
    await other.command({ duration: 250, action: 'right' });
    await delay(10);
    expect(received.some(message => message.action === 'right')).toBe(true);
});

test('E1Session: DID ownership rejects a duplicate at a different address without interrupting the active jog', async () => {
    const { target, session, received } = await createCamera(() => true, 'lumi1.testcamera');
    const other = new E1Session({
        getTarget: () => target,
        logger: { warn: () => undefined },
        discover: async () => ({ ...target, host: '127.0.0.2' })
    });
    onTestFinished(() => other.release());
    const moving = session.command({ action: 'left', duration: 1000 });
    await waitForAction(received, 'left');
    await expect(other.command({ duration: 250, action: 'right' })).rejects.toThrow(/already controlled/);
    await other.release();
    await moving;
    expect(received.find(message => message.action === 'stop')!.time - received[0].time).toBeGreaterThanOrEqual(900);
});

test('E1Session: settings cancellation relinquishes ownership after active stops are drained', async () => {
    const { target, session, received } = await createCamera();
    const other = new E1Session({ getTarget: () => target, logger: { warn: () => undefined } });
    onTestFinished(() => other.release());
    const moving = session.command({ action: 'left', duration: 1000 });
    await waitForAction(received, 'left');
    const cancelled = session.cancel();
    await expect(other.command({ duration: 250, action: 'right' })).rejects.toThrow(/already controlled/);
    await Promise.all([moving, cancelled]);
    await other.command({ duration: 250, action: 'right' });
});
