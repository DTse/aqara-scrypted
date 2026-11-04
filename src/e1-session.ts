import { Buffer } from 'node:buffer';
import { createSocket } from 'node:dgram';
import { setTimeout as delay } from 'node:timers/promises';

import { discoverE1 } from './e1-discovery';
import { encodeE1Message, decodeE1Message } from './e1-protocol';

import type { Socket } from 'node:dgram';
import type { E1Jog, E1Action } from './e1-protocol';
import type { E1Target, E1Address } from './e1-discovery';

interface E1SessionOptions {
    getTarget: () => E1Target;
    discover?: typeof discoverE1;
    logger: Pick<Console, 'warn'>;
    onDiscovered?: (address: E1Address) => void;
}

// All E1 extensions in this plugin share motor ownership, including aliases
// configured by IP on one video device and DID on another.
const E1_OWNERS = new Map<string, E1Session>();

const encodePtzCommand = (action: E1Action, controllerIp: string): Buffer =>
    encodeE1Message({ params: { action }, cmd: 'camera.ctrl_ptz' }, controllerIp);

/**
 * One operation owns its UDP socket, preventing late ACKs from older jogs matching
 * newer requests. New input cancels discovery/ACK waits and stops the old jog
 * before starting another. Directional datagrams are never retried.
 */
class E1Session {
    private active?: { abort: AbortController; promise: Promise<void> };
    private generation = 0;
    private ownedKeys = new Set<string>();
    private released = false;

    constructor(private readonly options: E1SessionOptions) {}

    async cancel(): Promise<void> {
        ++this.generation;
        this.active?.abort.abort();
        try {
            await this.active?.promise;
        } finally {
            this.releaseOwnership();
        }
    }

    async command(jog: E1Jog): Promise<void> {
        if (this.released) throw new Error('E1 controller has been released');
        const generation = ++this.generation;
        const previous = this.active;
        previous?.abort.abort();
        const abort = new AbortController();
        const promise = this.runAfter(previous?.promise, jog, abort.signal, generation);
        this.active = { abort, promise };
        try {
            await promise;
        } finally {
            if (this.active?.promise === promise) this.active = undefined;
        }
    }

    async release(): Promise<void> {
        this.released = true;
        await this.cancel();
    }

    private claimCamera(address: E1Address, target: E1Target): void {
        const keys = new Set([`ip:${address.host}`]);
        if (address.did) keys.add(`did:${address.did}`);
        if (target.did) keys.add(`did:${target.did}`);
        for (const key of keys) {
            const owner = E1_OWNERS.get(key);
            if (owner && owner !== this)
                throw new Error(
                    'This E1 is already controlled by another camera extension. Disable the other extension before controlling it here.'
                );
        }
        this.releaseOwnership();
        for (const key of keys) E1_OWNERS.set(key, this);
        this.ownedKeys = keys;
    }

    private closeSocket(socket: Socket): void {
        try {
            socket.close();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error;
        }
    }

    private async connect(socket: Socket, address: E1Address, signal: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                socket.off('error', onError);
                socket.off('connect', onConnect);
                signal.removeEventListener('abort', onAbort);
            };
            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };
            const onConnect = () => {
                cleanup();
                resolve();
            };
            const onAbort = () => onError(new Error('E1 connection cancelled'));
            const timer = setTimeout(() => onError(new Error('E1 connection timed out')), 1500);
            socket.once('error', onError);
            socket.once('connect', onConnect);
            signal.addEventListener('abort', onAbort, { once: true });
            socket.connect(address.port, address.host);
        });
    }

    private async exchange(socket: Socket, controllerIp: string, action: E1Action, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const finish = (error?: Error) => {
                clearTimeout(timer);
                socket.off('message', onMessage);
                socket.off('error', onError);
                signal?.removeEventListener('abort', onAbort);
                if (error) reject(error);
                else resolve();
            };
            const onError = (error: Error) => finish(error);
            const onAbort = () => finish(new Error('E1 command cancelled'));
            const onMessage = (data: Buffer) => {
                try {
                    const message = decodeE1Message(data, controllerIp);
                    if (message.cmd === 'camera.ctrl_ptz_done' && message.params?.action === action) finish();
                } catch {
                    // Unrelated or malformed datagrams do not acknowledge a command.
                }
            };
            const timer = setTimeout(
                () => finish(new Error(`E1 ${action} acknowledgement timed out; check controller IPv4 and control port`)),
                1500
            );
            socket.on('message', onMessage);
            socket.once('error', onError);
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) return onAbort();
            socket.send(encodePtzCommand(action, controllerIp), error => {
                if (error) finish(error);
            });
        });
    }

    private releaseOwnership(): void {
        for (const key of this.ownedKeys) {
            if (E1_OWNERS.get(key) === this) E1_OWNERS.delete(key);
        }
        this.ownedKeys.clear();
    }

    private async run(jog: E1Jog, signal: AbortSignal): Promise<void> {
        const target = this.options.getTarget();
        const address = await (this.options.discover ?? discoverE1)(target, signal);
        signal.throwIfAborted();
        this.claimCamera(address, target);
        this.options.onDiscovered?.(address);
        const socket = createSocket('udp4');
        // Keep errors handled even between individual ACK listeners.
        socket.on('error', error => this.options.logger.warn(`E1 UDP: ${error.message}`));
        let watchdog: NodeJS.Timeout | undefined;
        let controllerIp: string | undefined;
        let stopping: Promise<unknown> | undefined;
        const stop = () => {
            if (!stopping && controllerIp) {
                stopping = this.stopTwice(socket, controllerIp).catch((error: unknown) => {
                    this.options.logger.warn('E1 stop failed:', error);
                    return error;
                });
            }
            return stopping;
        };
        try {
            await this.connect(socket, address, signal);
            signal.throwIfAborted();
            controllerIp = target.controllerIp || socket.address().address;
            // Validate the source address before arming any motor command.
            encodePtzCommand('stop', controllerIp);
            if (jog.action === 'stop') return;
            const deadline = Date.now() + jog.duration;
            watchdog = setTimeout(stop, jog.duration);
            await this.exchange(socket, controllerIp, jog.action, signal);
            await delay(Math.max(0, deadline - Date.now()), undefined, { signal });
        } finally {
            if (watchdog) clearTimeout(watchdog);
            await this.stopAndClose(socket, stop());
        }
    }

    private async runAfter(previous: Promise<void> | undefined, jog: E1Jog, signal: AbortSignal, generation: number): Promise<void> {
        // The original caller observes the previous error; this barrier still
        // permits a subsequent command to recover with fresh discovery.
        await previous?.catch(() => undefined);
        if (signal.aborted || generation !== this.generation) return;
        try {
            await this.run(jog, signal);
        } catch (error) {
            if (!signal.aborted) throw error;
        }
    }

    private sendStop(socket: Socket, controllerIp: string): void {
        try {
            socket.send(encodePtzCommand('stop', controllerIp), error => {
                if (error) this.options.logger.warn(`E1 stop send failed: ${error.message}`);
            });
        } catch (error) {
            this.options.logger.warn('E1 stop send failed:', error);
        }
    }

    private async stopAndClose(socket: Socket, stopping?: Promise<unknown>): Promise<void> {
        try {
            const error = await stopping;
            if (error) throw error;
        } finally {
            this.closeSocket(socket);
        }
    }

    private async stopTwice(socket: Socket, controllerIp: string): Promise<void> {
        // Observe rejection immediately, but always send the second stop even if
        // the first fails. Stop ACK is a dispatch echo, not physical confirmation.
        const acknowledgement = this.exchange(socket, controllerIp, 'stop').catch((error: unknown) => error);
        await delay(250);
        this.sendStop(socket, controllerIp);
        const error = await acknowledgement;
        if (error) throw error;
    }
}

export { E1Session };
