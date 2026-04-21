# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
