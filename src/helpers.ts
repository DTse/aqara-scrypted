/**
 * Pure helpers extracted from camera.ts / protocol.ts so they can be unit-tested
 * without mocking Scrypted's SDK.
 */

import { Buffer } from 'node:buffer';
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

const VALID_CHANNEL_IDS = ['ch1', 'ch2', 'ch3'] as const;
type ChannelId = (typeof VALID_CHANNEL_IDS)[number];

interface RtspUrlParts {
    host: string;
    port: string;
    username?: string;
    password?: string;
    channelId: ChannelId;
}

const RING_ENDPOINT_REGEX = /\/ring\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/;

/** Constant-time compare on two UTF-8 strings. */
const timingSafeStringEqual = (a: string, b: string): boolean => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && nodeTimingSafeEqual(bufA, bufB);
};

/**
 * Pull the token out of a ring webhook URL path. Returns null when the path
 * doesn't match `/ring/<token>` (optionally with trailing slash and/or query
 * string). Token is restricted to url-safe chars.
 */
const parseRingEndpoint = (url: string | undefined): null | { token: string } => {
    if (!url) return null;
    const match = RING_ENDPOINT_REGEX.exec(url);
    return match ? { token: match[1] } : null;
};

/**
 * Clamp the intercom volume storage value to a usable multiplier. Non-finite,
 * non-positive, or unparseable values all collapse to 1.0 (no gain).
 */
const parseIntercomVolume = (raw: null | string | undefined): number => {
    if (raw == null || raw === '') return 1;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
};

/** Clamp a storage value to one of the known channel IDs. */
const resolveChannel = (raw: null | string | undefined, fallback: ChannelId): ChannelId => {
    if (!raw) return fallback;
    return (VALID_CHANNEL_IDS as readonly string[]).includes(raw) ? (raw as ChannelId) : fallback;
};

/**
 * Build an RTSP URL of the form `rtsp://[user:pass@]host:port/channel`.
 * Credentials are URL-encoded. Throws if host is empty.
 */
const buildRtspUrl = ({ host, port, username, password, channelId }: RtspUrlParts): string => {
    if (!host) {
        throw new Error('Camera host is not configured. Open the camera settings and set the IP Address.');
    }
    const user = username ? encodeURIComponent(username) : '';
    const pass = password ? encodeURIComponent(password) : '';
    const auth = user ? `${user}:${pass}@` : '';
    return `rtsp://${auth}${host}:${port}/${channelId}`;
};

export {
    buildRtspUrl,
    resolveChannel,
    type ChannelId,
    VALID_CHANNEL_IDS,
    parseRingEndpoint,
    type RtspUrlParts,
    parseIntercomVolume,
    timingSafeStringEqual
};
