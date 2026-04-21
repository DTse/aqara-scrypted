# Security Best Practices

This plugin is LAN-local by default, but it exposes an HTTP webhook endpoint and handles user credentials (RTSP username/password). Treat both carefully.

## Webhook tokens

- **Constant-time comparison only** for token validation. Use `timingSafeStringEqual` from `helpers.ts` (wraps `crypto.timingSafeEqual`). Never use `===` on tokens.
- **Tokens must be URL-safe.** The regex `[A-Za-z0-9_-]+` is the alphabet; `parseRingEndpoint` enforces it. Don't broaden the charset without reviewing URL-encoding implications.
- **Tokens generated via `crypto.randomBytes(16).toString('hex')`** — 128 bits of entropy, hex-encoded. Do not shorten.
- **Regeneration invalidates the old token immediately.** The "Regenerate Token" button overwrites storage; any caller still holding the old URL is locked out. This is intentional.
- **Log invalid attempts as warnings**, not errors (errors imply the plugin is broken; invalid webhook hits usually mean a misconfigured automation).

## Credentials

- **RTSP password is a password.** Setting type is `'password'` so the UI masks it. Don't log it. Don't include it in error messages. Don't echo it in the webhook URL (it's only in the RTSP URL handed to ffmpeg, which runs as a child process and inherits no broader access).
- **URL-encode credentials** when building RTSP URLs — `buildRtspUrl` in `helpers.ts` handles this. If you ever build an RTSP URL elsewhere, use the helper, don't hand-concatenate.

## Network boundaries

- **Assume the camera is on a trusted LAN.** We don't authenticate the RTSP server (Aqara's auth is username/password; we consume it). We don't authenticate the webhook caller beyond the per-camera token.
- **Scrypted's endpoint manager** handles auth for non-`/public/` paths. Our webhook is deliberately `/public/` — the token is the credential. Don't move it to a private path thinking it adds security; it just breaks the use case (external Matter controllers can't reach private paths).
- **Don't open new listeners.** The plugin should not bind additional TCP/UDP ports beyond what Scrypted provides (for webhooks) and what we use transiently during Intercom sessions (UDP 54323 for RTP out).

## Dependency hygiene

- **`pnpm audit`** before bumping major deps. Fix `high` and `critical` findings; evaluate `moderate` case-by-case.
- **Avoid transitive deps with native build steps** where possible — they bloat the plugin bundle and complicate cross-platform Scrypted deployments.
- **Pin `@scrypted/sdk`** is currently `"latest"`; this is a deliberate choice because Scrypted's API surface is effectively a platform, but re-audit if breakage recurs.

## Publishing

- **Never reintroduce an `NPM_TOKEN` secret** after Trusted Publishing (OIDC) is configured. The token was a bootstrap step; keeping it around defeats the point of OIDC.
- **Never commit credentials, API keys, or tokens to the repo.** The `.npmrc` in the repo contains only `node-linker=hoisted` — safe. `.gitignore` excludes `.env` and friends.
- **Provenance attestations are automatic** via `--provenance` on `pnpm publish` in CI. Don't strip the flag.

## Secrets in logs

- Scrypted's console captures what you pass to `this.console.*`. Anything logged there is visible in the Scrypted UI's plugin log tab and in export bundles.
  - **OK to log:** packet types, byte counts, timing, IP addresses, generic error messages, `this.nativeId`.
  - **Never log:** RTSP username/password, doorbell tokens, session keys, binary payloads (they can contain video key material).
