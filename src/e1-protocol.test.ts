import { Buffer } from 'node:buffer';
import { test, expect } from 'vitest';
import { createCipheriv } from 'node:crypto';

import { e1CameraKey, resolveE1Jog, encodeE1Message, decodeE1Message } from './e1-protocol';

import vectors from './e1-codec-vectors.json';

import type { PanTiltZoomCommand } from '@scrypted/sdk';

// Independent Python cryptography vectors from the E1 protocol investigation.
test('E1 codec: matches Python key bytes and ciphertext in both directions', () => {
    for (const vector of vectors) {
        expect(e1CameraKey(vector.controllerIp).toString('hex')).toBe(vector.keyHex);
        const encoded = encodeE1Message(vector.inner, vector.controllerIp);
        expect(JSON.parse(encoded.toString()).value).toBe(vector.value);
        expect(decodeE1Message(encoded, vector.controllerIp)).toEqual(vector.inner);
    }
});

test('E1 codec: rejects invalid source IPv4 and wrong keys', () => {
    for (const ip of ['', 'localhost', '::1', '256.1.2.3', '192.168.001.1']) expect(() => e1CameraKey(ip)).toThrow(/IPv4/);
    expect(() => decodeE1Message(encodeE1Message({ cmd: 'camera.ctrl_ptz' }, '192.0.2.1'), '192.0.2.2')).toThrow();
});

test('E1 codec: rejects malformed envelopes and noncanonical ciphertext', () => {
    for (const envelope of [
        null,
        [],
        {},
        { value: '', name: 'other' },
        { value: 7, name: 'system.camera' },
        ...['', '!', 'AAAA', 'A'.repeat(23), 'A'.repeat(24), `${vectors[0].value}\n`].map(value => ({ value, name: 'system.camera' }))
    ]) {
        expect(() => decodeE1Message(Buffer.from(JSON.stringify(envelope)), '192.0.2.1')).toThrow();
    }
    expect(() => decodeE1Message(Buffer.from('{'), '192.0.2.1')).toThrow();
});

test('E1 codec: rejects decrypted non-JSON, invalid command and action shapes', () => {
    for (const plaintext of ['{', 'null', '[]', '{}', '{"cmd":3}', '{"cmd":"x","params":null}', '{"cmd":"x","params":{"action":2}}']) {
        const cipher = createCipheriv('aes-128-cbc', e1CameraKey('192.0.2.1'), Buffer.from('ddb3ba695a2e6f58562e17996d093d28', 'hex'));
        const value = Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
        expect(() => decodeE1Message(Buffer.from(JSON.stringify({ value, name: 'system.camera' })), '192.0.2.1')).toThrow();
    }
});

test('resolveE1Jog: maps signs, zero and timeout units to bounded jogs', () => {
    expect(resolveE1Jog({ pan: -0.5 })).toEqual({ duration: 300, action: 'left' });
    expect(resolveE1Jog({ pan: 1, timeout: 2000 })).toEqual({ duration: 1000, action: 'right' });
    expect(resolveE1Jog({ tilt: 1, timeout: 10 })).toEqual({ action: 'up', duration: 250 });
    expect(resolveE1Jog({ tilt: -1 }, 400)).toEqual({ duration: 400, action: 'down' });
    expect(resolveE1Jog({ pan: 1, timeout: 0 })).toEqual({ duration: 0, action: 'stop' });
    expect(resolveE1Jog({})).toEqual({ duration: 0, action: 'stop' });
});

test('resolveE1Jog: rejects unsupported modes and invalid numeric input', () => {
    const commands: PanTiltZoomCommand[] = [
        { pan: 1, tilt: 1 },
        { zoom: 1 },
        { speed: {} },
        { preset: 'home' },
        { pan: NaN },
        { tilt: Infinity },
        { pan: 1.1 },
        { timeout: -1 },
        { timeout: NaN },
        ...['Absolute', 'Continuous', 'Home', 'Preset'].map(movement => ({ movement }) as PanTiltZoomCommand)
    ];
    for (const command of commands) expect(() => resolveE1Jog(command)).toThrow();
});
