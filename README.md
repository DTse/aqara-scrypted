# Aqara Scrypted Plugin

A [Scrypted](https://scrypted.app) plugin for Aqara cameras that expose **RTSP LAN Preview** (tested against the Aqara G410). Based on https://github.com/Darkdragon14/ha-aqara-devices and https://github.com/absent42/aqara-doorbell

## Status

| Feature | Status |
|---|---|
| Live video (main + substream) | ✅ |
| Snapshots (synthesized from stream) | ✅ |
| Two-way audio (talkback) | ✅ |
| Intercom volume control | ✅ |
| Doorbell press events | ✅ via webhook (see [Doorbell ring events](#doorbell-ring-events) below) |
| Motion events | Use Scrypted Object Detector (see [Motion detection](#motion-detection) below) |

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
4. (Optional) Set up ring events — see below.

## Channels

The G410 exposes three RTSP channels on port 8554:

| Channel | Approx. resolution |
|---|---|
| `ch1` | Main (1600×1200 observed; varies by firmware) |
| `ch2` | Medium |
| `ch3` | Sub (low-bitrate, for thumbnails) |

Set the main/substream channel in each camera's Settings tab. Scrypted probes the actual stream dimensions at connection time, so the numbers above are informational only.

## Doorbell ring events

The G410's LAN protocol does **not** expose ring events directly — Aqara migrated to an encrypted ECDH+AES tunnel in newer firmware and the event is not visible to third-party plugins without a runtime DEX unpack of the official app (out of scope here).

The plugin works around this by exposing a **webhook URL per camera**. You wire that webhook up once to any trigger source (Aqara's own Matter Signal Sync via Home Assistant or Apple Home, an existing NVR, a physical switch, or anything else that can make an HTTP request). When the webhook fires, the camera's Scrypted Doorbell / BinarySensor turns on for 10 seconds — HomeKit, Scrypted NVR, and everything else downstream see it as a real ring.

### The webhook

Each camera's settings page has a `Doorbell Ring Events` section showing a URL like:

```
http://<scrypted-host>:<port>/endpoint/aqara-scrypted/public/ring/<token>
```

- **GET or POST, both work.** Any HTTP method with a 2xx response is accepted.
- **Token is per-camera.** Keep it secret — treat it like a password. Use **Regenerate Token** if it leaks; the old URL stops working immediately.
- **Test Trigger** button — fires the ring locally without hitting the URL. Use it first to confirm HomeKit/NVR react, before you set up the Matter side.

### Setup recipes

Pick one depending on what you already run. All three start with the same one-time step in Aqara Home:

> **One-time Aqara setup:** Open the Aqara Home app → Profile → **Connected Ecosystems** → **Matter** → **Scene and Signal Sync** → **Signal Management** → create a new signal: *"When the doorbell is pressed"* → save. This exposes the G410's press event as a Matter `BooleanState` cluster on its Matter bridge.
>
> Then pair the G410's Matter bridge to one of the controllers below.

#### Recipe 1 — Home Assistant (most common)

After pairing the G410 Matter bridge to HA's built-in Matter integration:

1. Find the doorbell press entity. It will be something like `event.aqara_g410_front_door_video_doorbell_ringing` or `binary_sensor.aqara_g410_doorbell_pressed` depending on your HA version. Press the button once and watch **Developer Tools → States** to confirm the entity updates when pressed.

2. Add to `configuration.yaml` (this declares a reusable HTTP action):

   ```yaml
   rest_command:
     scrypted_aqara_ring:
       url: "http://SCRYPTED_HOST:PORT/endpoint/aqara-scrypted/public/ring/YOUR_TOKEN"
       method: POST
   ```

   Then **Developer Tools → YAML → Reload `rest_command`** (or restart HA).

3. Create the automation. In the HA UI: **Settings → Automations & Scenes → Create Automation → Start with an empty automation → ⋮ menu → Edit in YAML**. Paste:

   ```yaml
   alias: "Aqara G410 → Scrypted ring"
   mode: single
   triggers:
     - trigger: state
       entity_id: event.aqara_g410_front_door_video_doorbell_ringing # change depending on your setup
   conditions: []
   actions:
     - action: rest_command.scrypted_aqara_ring
   ```

   Replace the `entity_id` with whatever the Matter integration actually created. Save.

4. Press the doorbell → Scrypted fires a ring within ~1 second. If nothing happens, open **Settings → Automations → your automation → Traces** to see whether the trigger fired and whether the action succeeded.

#### Recipe 2 — Apple Home / Shortcuts

After pairing the G410 Matter bridge to Apple Home:

1. Open the **Home** app → the doorbell accessory → **Automation** (gear icon) → **Add Automation**.
2. Trigger: **An Accessory is Controlled** → select the Aqara doorbell press sensor.
3. Under actions, scroll past the accessories list and tap **Convert To Shortcut**.
4. Remove any default actions. Add the **Get Contents of URL** action (Shortcuts → Web).
5. Set URL to your webhook URL. Method: POST. No body needed.
6. Save. Press the doorbell → Shortcuts fires the URL.

Note: Apple's HomeKit automation runs on a hub (HomePod/Apple TV/iPad). That hub must be able to reach your Scrypted host. If Scrypted is only reachable over Scrypted Cloud, use the cloud endpoint URL instead of the local one — you can get it from `endpointManager.getCloudEndpoint` equivalents in the Scrypted Cloud plugin.

#### Recipe 3 — Raw curl (testing / custom integrations)

```bash
curl -X POST "http://SCRYPTED_HOST:PORT/endpoint/aqara-scrypted/public/ring/YOUR_TOKEN"
```

Useful for wiring up anything that can make an HTTP call: a shell script, a node-red flow, an IFTTT webhook, an ESP32 with a button, etc.

### Why a webhook instead of native Matter?

Scrypted doesn't have a Matter controller plugin as of 2026 — it can't commission and subscribe to Matter devices directly. Once Scrypted ships Matter controller support, this plugin will likely consume the G410's `BooleanState` cluster natively and the webhook will become optional. Until then, the webhook is the reliable path.

## Motion detection

The Aqara LAN protocol does **not** expose motion events to third parties. Best options:

1. **Recommended:** install the [`@scrypted/objectdetector`](https://github.com/koush/scrypted/tree/main/plugins/objectdetector) plugin plus a detector (`@scrypted/tensorflow-lite`, or Scrypted NVR's detection if you have an NVR license). Gives you object-aware motion (person / car / animal) that Aqara's native PIR can't.
2. Use Scrypted's built-in motion detection plugin for basic frame-diff motion.
3. If the camera is already paired to Home Assistant via HomeKit Controller, HA exposes the native PIR motion sensor. Bridge that entity into Scrypted via the Home Assistant plugin.
