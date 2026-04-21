# Project Goals

This is a [Scrypted](https://scrypted.app) plugin for **Aqara cameras** (tested on G410; other Aqara models that expose RTSP LAN Preview likely work but are unverified). It ships as an npm package that Scrypted users install directly from the Scrypted UI.

## Core principles

- **Stability over features.** This plugin exposes cameras to HomeKit Secure Video, Scrypted NVR, and other critical downstream consumers. A crash here means someone's doorbell goes silent. Favour well-tested, robust code paths.
- **Zero-build install for end users.** A non-technical user should be able to install the plugin from Scrypted's plugin registry and add a camera in under two minutes.
- **Honest about limitations.** Aqara's LAN protocol is partially encrypted and partially undocumented. Don't claim to support features we can't actually deliver (e.g., native ring-event detection). Document workarounds (webhook + Matter Signal Sync) where direct support isn't possible.
- **Minimal surface area.** Only expose Scrypted interfaces we can actually back. Don't declare `MotionSensor` if we can't detect motion.
- **Don't reinvent.** Use Scrypted SDK types, standard Node modules, FFmpeg (for AAC encoding), and established Node conventions. Only build in-house when no good library exists.
- **Performance matters.** Live video, RTP audio, and webhook handling must stay responsive. Avoid blocking the event loop; no synchronous I/O.

## Non-goals

- **Cloud integration.** This plugin is LAN-only. Users who need cloud features use Aqara's own app.
- **Device pairing / onboarding.** Cameras are set up via Aqara Home first; we only consume the already-paired RTSP stream.
- **Supporting every Aqara model.** We target what we can test. Others work by accident, not by design.
