# Aqara Scrypted Plugin

A [Scrypted](https://scrypted.app) plugin for Aqara cameras (built and tested against the **Aqara G410** doorbell, should work with other Aqara models that expose RTSP LAN Preview).

## Status — Phase 1 (RTSP MVP)

| Feature | Status |
|---|---|
| Live video (main + substream) | ✅ |
| Snapshots | ✅ (synthesized from stream) |
| Motion events | ⏳ Phase 2 |
| Doorbell press events | ⏳ Phase 2 |
| Two-way audio | ⏳ Phase 3 |
| Record-on-ring | ⏳ Phase 2 (needs doorbell events) |

## Prerequisites

1. Hardwired G410 (RTSP does not work on battery-only mode).
2. In the **Aqara Home app**:
   - Open the G410 → Settings → **RTSP LAN Preview** → enable.
   - Copy the generated **username** and **password**.
   - Note the camera's LAN IP address (Settings → Network).

## Install

```bash
cd aqara-scrypted
npm install
npm run build
```

Then in Scrypted → Plugins → Install from file, point at `dist/plugin.zip`. Or run `npm run scrypted-deploy <host>` to push directly to a running Scrypted instance.

## Configure

1. Scrypted UI → Plugins → **Aqara Plugin** → **Add Device**.
2. Fill in:
   - **Name**: e.g. "Front Door"
   - **IP Address**: LAN IP of the camera
   - **RTSP Username / Password**: from the Aqara Home app
   - **Is a Doorbell**: leave on for G410
3. The camera appears in Scrypted. Open it and confirm live view works.

## Channels

Aqara exposes three RTSP substreams:

| Channel | Resolution | Typical use |
|---|---|---|
| `ch1` | 2304×1728 (2K) | HKSV / NVR recording |
| `ch2` | 1920×1080 | |
| `ch3` | 640×480 | Thumbnails, small tiles |

Set the main/substream channel in each camera's Settings.

## Next phases

- **Phase 2** — listen on UDP multicast `230.0.0.1:10008` (doorbell) and TCP `54324` (control channel events) to fire Motion/BinarySensor state changes. This enables record-on-ring in HKSV and Scrypted NVR.
- **Phase 3** — implement the UDP RTP backchannel on port `54323` for 2-way audio (Scrypted `Intercom` interface).

Both phases are based on the reverse-engineered protocol documented by [absent42/aqara-doorbell](https://github.com/absent42/aqara-doorbell) for the G400 (G410's sister model); G410 protocol parity will be confirmed via packet capture before implementation.
