import { isIPv4 } from 'node:net';
import { Buffer } from 'node:buffer';
import { createHash, createCipheriv, createDecipheriv } from 'node:crypto';

import type { PanTiltZoomCommand } from '@scrypted/sdk';

type E1Action = 'down' | 'left' | 'right' | 'stop' | 'up';

interface E1Jog {
    action: E1Action;
    duration: number;
}

interface E1Message {
    cmd: string;
    dpi?: string;
    params?: { action?: string };
}

// Recovered from Camera E1 lumi.camera.acn006 firmware 4.5.20_0020,
// ha_master:0x25cac8 / 0x269cbc; verified against the owner's installed E1.
const E1_IV = Buffer.from('ddb3ba695a2e6f58562e17996d093d28', 'hex');

/** Hash the little-endian source IPv4 bytes, not the camera IP or ASCII hex. */
const e1CameraKey = (controllerIp: string): Buffer => {
    if (!isIPv4(controllerIp)) throw new Error('Controller address must be IPv4');
    return createHash('md5')
        .update(Buffer.from(controllerIp.split('.').map(Number)).reverse())
        .digest();
};

const encodeE1Message = (inner: E1Message, controllerIp: string): Buffer => {
    const cipher = createCipheriv('aes-128-cbc', e1CameraKey(controllerIp), E1_IV);
    const value = Buffer.concat([cipher.update(JSON.stringify(inner), 'utf8'), cipher.final()]).toString('base64');
    return Buffer.from(JSON.stringify({ value, name: 'system.camera' }));
};

/** Reject malformed envelopes, noncanonical Base64, padding, JSON and command shapes. */
const decodeE1Message = (datagram: Buffer, controllerIp: string): E1Message => {
    const envelope: unknown = JSON.parse(datagram.toString('utf8'));
    if (
        !envelope ||
        typeof envelope !== 'object' ||
        !('name' in envelope) ||
        envelope.name !== 'system.camera' ||
        !('value' in envelope) ||
        typeof envelope.value !== 'string'
    )
        throw new Error('Invalid E1 envelope');
    const ciphertext = Buffer.from(envelope.value, 'base64');
    if (!ciphertext.length || ciphertext.length % 16 || ciphertext.toString('base64') !== envelope.value)
        throw new Error('Invalid E1 ciphertext');
    const decipher = createDecipheriv('aes-128-cbc', e1CameraKey(controllerIp), E1_IV);
    const inner: unknown = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    if (!inner || typeof inner !== 'object' || !('cmd' in inner) || typeof inner.cmd !== 'string') throw new Error('Invalid E1 command');
    if (
        'params' in inner &&
        (!inner.params || typeof inner.params !== 'object' || !('action' in inner.params) || typeof inner.params.action !== 'string')
    )
        throw new Error('Invalid E1 action');
    return inner as E1Message;
};

/** Relative values select direction only; jogs are not calibrated angular travel. */
const resolveE1Jog = (command: PanTiltZoomCommand, defaultDuration = 300): E1Jog => {
    const pan = command.pan ?? 0;
    const tilt = command.tilt ?? 0;
    if (![pan, tilt].every(value => Number.isFinite(value) && Math.abs(value) <= 1))
        throw new Error('Pan and tilt must be finite values between -1 and 1');
    if (command.zoom !== undefined && command.zoom !== 0) throw new Error('E1 zoom is unsupported');
    if (command.preset !== undefined || command.speed !== undefined) throw new Error('E1 presets and speed are unsupported');
    if (command.movement !== undefined && command.movement !== 'Relative') throw new Error('E1 supports Relative jogs only');
    const duration = command.timeout ?? defaultDuration;
    if (!Number.isFinite(duration) || duration < 0) throw new Error('Jog timeout must be a nonnegative number of milliseconds');
    if (pan && tilt) throw new Error('E1 diagonal movement is unsupported; use one axis at a time');
    if ((!pan && !tilt) || duration === 0) return { duration: 0, action: 'stop' };
    const action = pan ? (pan < 0 ? 'left' : 'right') : tilt > 0 ? 'up' : 'down';
    return { action, duration: Math.max(250, Math.min(1000, duration)) };
};

export { type E1Jog, e1CameraKey, resolveE1Jog, type E1Action, type E1Message, encodeE1Message, decodeE1Message };
