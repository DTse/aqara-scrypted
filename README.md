# Aqara Scrypted Plugin

A [Scrypted](https://scrypted.app) plugin for Aqara cameras that expose **RTSP LAN Preview** (tested against the Aqara G410).

## Status

| Feature | Status |
|---|---|
| Live video (main + substream) | ✅ |
| Snapshots (synthesized from stream) | ✅ |
| Motion events | Use Scrypted Object Detector (see below) |
| Doorbell press events | ❌ Not implemented — Aqara broadcasts indistinguishable heartbeat packets on the multicast ring channel |
| Two-way audio | ❌ Not implemented |

## Prerequisites

1. The camera must be hardwired (RTSP does not work on battery-only models).
2. In the **Aqara Home app**:
   - Open the camera → Settings → **RTSP LAN Preview** → enable.
   - Copy the generated **username** and **password**.
   - Note the camera's LAN IP address.

## Install

```bash
npm install
npm run build
npm run scrypted-deploy <your-scrypted-host>
```

Or upload `dist/plugin.zip` via Scrypted → Plugins → Install from file.

## Configure

1. Scrypted UI → Plugins → **Aqara Plugin** → **Add Device**.
2. Fill in name, IP address, RTSP username, RTSP password.
3. Open the new camera and confirm live view works.

## Channels

The G410 exposes three RTSP channels on port 8554:

| Channel | Approx. resolution |
|---|---|
| `ch1` | Main (1600×1200 observed; varies by firmware) |
| `ch2` | Medium |
| `ch3` | Sub (low-bitrate, for thumbnails) |

Set the main/substream channel in each camera's Settings tab. Scrypted probes the actual stream dimensions at connection time, so the numbers above are informational only.

## Motion detection

The Aqara LAN protocol does **not** expose motion events to third parties. Best options:

1. **Recommended:** install the [`@scrypted/objectdetector`](https://github.com/koush/scrypted/tree/main/plugins/objectdetector) plugin plus a detector (`@scrypted/tensorflow-lite`, or Scrypted NVR's detection if you have an NVR license). Gives you object-aware motion (person / car / animal) that Aqara's native PIR can't.
2. Use Scrypted's built-in motion detection plugin for basic frame-diff motion.
3. If the camera is already paired to Home Assistant via HomeKit Controller, HA exposes the native PIR motion sensor. Bridge that entity into Scrypted via the Home Assistant plugin.
