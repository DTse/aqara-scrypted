/**
 * Pure helpers extracted from camera.ts / protocol.ts so they can be unit-tested
 * without mocking Scrypted's SDK.
 */

import { Buffer } from 'node:buffer';
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

export const VALID_CHANNEL_IDS = ['ch1', 'ch2', 'ch3'] as const;
export type ChannelId = (typeof VALID_CHANNEL_IDS)[number];

/** Constant-time compare on two UTF-8 strings. */
export function timingSafeStringEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && nodeTimingSafeEqual(bufA, bufB);
}

/**
 * Pull the token out of a ring webhook URL path. Returns null when the path
 * doesn't match `/ring/<token>` (optionally with trailing slash and/or query
 * string). Token is restricted to url-safe chars.
 */
export function parseRingEndpoint(url: string | undefined): null | { token: string } {
    if (!url) return null;
    const match = new RegExp(/\/ring\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/).exec(url);
    return match ? { token: match[1] } : null;
}

/**
 * Clamp the intercom volume storage value to a usable multiplier. Non-finite,
 * non-positive, or unparseable values all collapse to 1.0 (no gain).
 */
export function parseIntercomVolume(raw: null | string | undefined): number {
    if (raw == null || raw === '') return 1;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
}

/** Clamp a storage value to one of the known channel IDs. */
export interface RtspUrlParts {
    host: string;
    port: string;
    username?: string;
    password?: string;
    channelId: ChannelId;
}

export function resolveChannel(raw: null | string | undefined, fallback: ChannelId): ChannelId {
    if (!raw) return fallback;
    return (VALID_CHANNEL_IDS as readonly string[]).includes(raw) ? (raw as ChannelId) : fallback;
}

/**
 * Build an RTSP URL of the form `rtsp://[user:pass@]host:port/channel`.
 * Credentials are URL-encoded. Throws if host is empty.
 */
export function buildRtspUrl(parts: RtspUrlParts): string {
    if (!parts.host) {
        throw new Error('Camera host is not configured. Open the camera settings and set the IP Address.');
    }
    const user = parts.username ? encodeURIComponent(parts.username) : '';
    const pass = parts.password ? encodeURIComponent(parts.password) : '';
    const auth = user ? `${user}:${pass}@` : '';
    return `rtsp://${auth}${parts.host}:${parts.port}/${parts.channelId}`;
}
