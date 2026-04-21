# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-04-21

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

## [Released]

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
