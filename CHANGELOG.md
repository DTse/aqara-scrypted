# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.8] - 2026-04-24

### Added

- **Third RTSP stream exposed to rebroadcast, with a matching "Middle
  Stream Channel" setting.** Previously only the configured Main and
  Sub channels surfaced in `getVideoStreamOptions`, so rebroadcast saw
  2 streams even though the G410 advertises three. A new Middle channel
  setting (default `ch2`, 1280×720) is configurable in the camera's
  general settings tab, and all three channels now appear to
  rebroadcast, ordered Main → Sub → Middle (duplicates collapsed).

## [1.0.7] - 2026-04-23

### Fixed

- **Choppy / jittery audio and visual artifacts in FFmpeg parser mode.**
  Two FFmpeg input flags are now passed for every stream:
  `-use_wallclock_as_timestamps 1` replaces the G410's irregular RTP
  timestamps with wall-clock time, eliminating the audio jitter and
  frame-ordering artifacts; `-fflags +discardcorrupt` drops any corrupted
  partial frames that FFmpeg would otherwise try to decode when the stream
  starts mid-GOP.  Additionally, the stream metadata now advertises the
  correct AAC sample rate (16 kHz) so Scrypted can configure its audio
  pipeline without guessing.
  Users who switch the Scrypted stream parser to "FFmpeg" should see
  both issues resolved. (The Scrypted native parser does not use these
  arguments; if you stay on the native parser and still hear choppiness,
  switch to FFmpeg in the camera's stream settings.)

## [1.0.6] - 2026-04-23

### Fixed

- **"Add Device" failed** with
  `Cannot read properties of undefined (reading 'storage')` from
  `engine.io-client:api`. `AqaraProvider.createDevice` was calling
  `deviceManager.getDeviceStorage(nativeId).setItem(...)` **before**
  `deviceManager.onDeviceDiscovered(device)`. In the current Scrypted SDK,
  storage is allocated during discovery, so the pre-discovery
  `getDeviceStorage` call returned undefined and subsequent `setItem`
  threw. Reordered so discovery runs first, then initial config is
  written to storage. Matches the pattern used by `@scrypted/reolink` and
  `@scrypted/onvif`.

### Changed

- Clarified the `CLAUDE.md` changelog rule: never add entries to an
  already-shipped version — create a new `## [X.Y.Z] - DATE` section at
  the top of the file instead. Documents how to pick the bump level and
  reminds that `package.json` is bumped by the user at release time, not
  by Claude.

## [1.0.5] - 2026-04-22

### Fixed

- **Plugin install from Scrypted UI failed** with
  `Cannot read properties of undefined (reading 'toString')` from
  `engine.io-client:api`. Root cause: `scrypted-webpack` outputs to `dist/`
  in production (`NODE_ENV=production`, what `prepublishOnly` runs) but to
  `out/` in dev. Our published tarball's `files: ["out/", "README.md"]`
  therefore included an empty `out/` — the actual `dist/plugin.zip` that
  `prepublishOnly` produced was excluded. Scrypted's installer looks at
  `dist/plugin.zip` (as every official Scrypted plugin ships) and found
  nothing. Fixed by changing `files` to `["dist/"]` and removing the
  `main: "out/main.nodejs.js"` field (not used by Scrypted's plugin
  loader, and pointing at a webpack bundle that requires Scrypted's
  runtime context caused a secondary failure during metadata inspection).
  Sideloading via `pnpm run scrypted-deploy` was unaffected because it
  uploads `out/plugin.zip` directly.

## [1.0.4] - 2026-04-21

### Fixed

- **Plugin install from Scrypted UI failed** with
  `Cannot read properties of undefined (reading 'toString')` from
  `engine.io-client:api`. Root cause: `scrypted-webpack` outputs to `dist/`
  in production (`NODE_ENV=production`, what `prepublishOnly` runs) but to
  `out/` in dev. Our published tarball's `files: ["out/", "README.md"]`
  therefore included an empty `out/` — the actual `dist/plugin.zip` that
  `prepublishOnly` produced was excluded. Scrypted's installer looks at
  `dist/plugin.zip` (as every official Scrypted plugin ships) and found
  nothing. Fixed by changing `files` to `["dist/"]` and removing the
  `main: "out/main.nodejs.js"` field (not used by Scrypted's plugin
  loader, and pointing at a webpack bundle that requires Scrypted's
  runtime context caused a secondary failure during metadata inspection).
  Sideloading via `pnpm run scrypted-deploy` was unaffected because it
  uploads `out/plugin.zip` directly.

### Added

- `CLAUDE.md` with contributor / AI-assistant guidance. Makes it a hard
  rule that every change must be logged against the current in-progress
  version header (not `## [Unreleased]`), and documents tooling
  constraints (pnpm, Node 24, hoisted linker) plus architectural decisions
  already made (ring via webhook, no Matter controller, motion out of
  scope).
- `.claude/rules/` — nine rule files covering core approach, goals, coding
  conventions, naming, module organization, testing, documentation,
  recommended practices, and security. `CLAUDE.md` now references them as
  mandatory and specifies that `security.md` takes precedence in
  conflicts.

### Changed

- **Codebase aligned to `.claude/rules/`.** Converted module-level `export
  function` declarations in `src/protocol.ts` and `src/helpers.ts` to
  arrow-function consts to match the "prefer arrow functions" coding rule
  (classes retained where required by the Scrypted SDK or by long-lived
  session lifecycle, per the documented exception).
- **`src/camera.ts` cleanup:**
  - Removed stale `// ---------- Section ----------` divider comments left
    behind after linter-driven method reordering; they no longer matched
    the surrounding code.
  - Replaced unsafe `id in CHANNELS` checks with `Object.hasOwn(CHANNELS,
    id)` to avoid matching inherited object properties.
  - Removed dead `try/catch` around a synchronous destructuring that
    cannot throw.
  - Extracted magic numbers (`54324`, `3000`) into named constants
    `CONTROL_PORT`, `PROBE_CONNECT_TIMEOUT_MS`, `PROBE_ACK_TIMEOUT_MS`.
  - Simplified `getDoorbellToken` to use an early return instead of
    `let`-reassignment.
- **`src/provider.ts` deduplication:** extracted shared `AQARA_DEVICE_INFO`
  and `AQARA_CAMERA_INTERFACES` constants (previously duplicated between
  `createDevice` and `resyncDevices`).
- **`src/helpers.ts`:** destructured `buildRtspUrl` parameters at the
  signature site for readability; moved the stray JSDoc comment that the
  linter had orphaned above `RtspUrlParts` back above `resolveChannel`
  where it belongs.
- Extended `.claude/rules/coding-conventions.md` to explicitly carve out
  when classes are still acceptable (Scrypted SDK bases, long-lived
  stateful sessions) to match existing architectural constraints.
- **Consolidated module exports at the end of each source file.** Added a
  new rule to `.claude/rules/coding-conventions.md` forbidding inline
  `export` keywords on declarations and requiring every module to end with
  a single `export { … }` block (with inline `type` markers for
  type-only exports). Applied across `src/protocol.ts`, `src/helpers.ts`,
  `src/camera.ts`, `src/provider.ts`, and `src/intercom-session.ts`. The
  plugin entry point `src/main.ts` keeps its `export { … } from '…'`
  re-export. ESLint's `perfectionist/sort-named-exports` handles ordering.

### Changed

- **README rewritten for end users.** The Install section now walks through
  the Scrypted UI (Plugins → Install a Plugin → search `aqara-scrypted`);
  no terminal, build step, or repo clone required. Added explicit
  **Updating** and **Uninstalling** sections.
- The old `pnpm install / build / scrypted-deploy` flow moved to a new
  **Development** section at the bottom of the README for contributors.

## [1.0.0] - 2026-04-21

First public release. Targets Aqara G410; likely works on other Aqara cameras that expose RTSP LAN Preview (untested).

### Added

- **Live video** over RTSP with configurable main + substream channel selection
  (G410 channels `ch1` / `ch2` / `ch3`).
- **Snapshots** synthesized from the active stream.
- **Two-way audio** (Intercom) — TCP control session on port 54324 plus UDP RTP
  AAC-LC on port 54323, with 5 s heartbeat keepalive.
- **Intercom volume multiplier** (default 2.5×) with an `acompressor` soft-limiter
  to preserve voice articulation at moderate boost levels.
- **Doorbell ring events** via per-camera HTTP webhook. Works with any Matter
  controller (Home Assistant, Apple Home, etc.) via Aqara Home's "Scene and
  Signal Sync" feature. Copy-paste setup recipes in the README.
- **Webhook tooling in settings:** read-only URL display, **Send Test Trigger**
  button, **Regenerate Token** button.
- **Diagnostic tools** in settings: TCP intercom probe (raw
  `START_VOICE`/`ACK` handshake) and a 3 s 440 Hz test tone.
- Full unit test suite for the LAN protocol codec and URL/token helpers.
- CI workflow: typecheck + lint + vitest + build on push/PR.
- Release workflow: tag-triggered publish to npm + GitHub release with
  `plugin.zip` attached.

### Known limitations

- Motion detection is not surfaced — Aqara's LAN protocol doesn't expose it to
  third parties. Use `@scrypted/objectdetector` on the video stream instead,
  or bridge the native PIR via Home Assistant.
- Native Matter consumption of the doorbell event isn't possible today because
  Scrypted has no Matter controller plugin; the webhook bridges through
  whatever Matter controller you already run.
