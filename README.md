# Aqara Scrypted Plugin

A [Scrypted](https://scrypted.app) plugin for Aqara cameras that expose **RTSP LAN Preview** (tested against the Aqara G410). Based on https://github.com/Darkdragon14/ha-aqara-devices and https://github.com/absent42/aqara-doorbell

Also provides optional **Camera E1 local pan/tilt** for a camera whose video is already supplied to Scrypted, for example through go2rtc. E1 does not need the G410 RTSP LAN Preview feature.

## Status

| Feature | Status |
|---|---|
| Live video (main + substream) | ✅ |
| Snapshots (synthesized from stream) | ✅ |
| Two-way audio (talkback) | ✅ |
| Intercom volume control | ✅ |
| Doorbell press events | ✅ via webhook (see [Doorbell ring events](#doorbell-ring-events) below) |
| Motion events | Use Scrypted Object Detector (see [Motion detection](#motion-detection) below) |
| Camera E1 pan/tilt | Optional extension; bounded local jogs (see below) |

## Camera E1 local pan/tilt

For **Camera E1 / CH-C01E / `lumi.camera.acn006`**. The underlying protocol was verified on an owner's E1, including movement with WAN blocked. This plugin implementation has automated codec and simulated UDP tests; installation on a real Scrypted server and camera acceptance tests are still required.

1. Add your E1 video to Scrypted using its existing video source. For go2rtc, use Scrypted's RTSP Camera plugin with your go2rtc RTSP URL. Keep its existing HomeKit pairing in go2rtc.
2. On that camera's **Extensions** page, enable **Aqara Plugin**. This extension is offered to video cameras without an existing PTZ interface; enable it only on the E1. Do not add the E1 through this plugin's G410 **Add Device** flow.
3. In **Aqara E1 Local PTZ** settings, enter the **camera's IPv4**. Leave **Manual control port** empty to discover `_aqara-setup._tcp` directly. Its advertised port accepts **UDP**, despite the service name.
4. The discovered DID is saved so subsequent commands can follow DHCP address changes. You can also enter the DID directly. Attach this extension only once per physical camera.
5. Use the camera's PTZ controls for short pan/tilt jogs. **Stop motor** sends repeated stop commands, including when no jog is active.

The default jog is **300 ms**, bounded to **250–1000 ms**. Signed relative pan/tilt selects a direction; magnitude is not a calibrated angle. Both axes zero or a zero timeout stops movement. Diagonal movement, continuous/absolute modes, zoom, presets, home and speed settings are rejected. New input cancels the previous operation and drains its stops before starting another. A watchdog sends stop at the jog deadline and repeats it 250 ms later, even if the movement acknowledgement is lost. Release and settings changes stop any active operation. UDP delivery and physical movement cannot be guaranteed by an acknowledgement.

Use **host networking** for Scrypted where possible. With source NAT, set **Controller IPv4 override** to the source address the camera sees, usually the host's LAN IPv4. The protocol derives its AES key from that address; a container's internal address produces the wrong key. Multicast must reach Scrypted for automatic discovery. Without multicast, enter both the camera IPv4 and current control port manually; the port can change on reboot. Discovery runs afresh for each operation, and directional commands are never automatically retried.

This adds PTZ only. Video, audio, pairing, motion events and intercom remain with the video source. No Aqara cloud credentials, rotation scenes, firmware changes or ONVIF server are required. The predictable encryption is not secret-based authentication; keep the camera control service on your trusted LAN.

Before relying on E1 support, verify camera reboot and plugin restart with WAN blocked, all four directions, mechanical limits and mounting orientation, stop under repeated input and packet loss, the actual container source address, and video while moving. Keep the tested short jogs; long-term behavior and other firmware/models remain unverified.

## Prerequisites

1. The camera must be hardwired (RTSP does not work on battery-only models).
2. In the **Aqara Home app**:
   - Open the camera → Settings → **RTSP LAN Preview** → enable.
   - Copy the generated **username** and **password**.
   - Note the camera's LAN IP address.

## Install

1. Open the **Scrypted** web UI.
2. Click **Plugins** in the sidebar, then click **Install a Plugin**.
3. Search for **`aqara-scrypted`** in the npm registry and click **Install**.
4. Wait a few seconds for Scrypted to download and initialise the plugin — you'll see **Aqara Plugin** appear in the plugin list.

No terminal, no build step, no file upload needed.

## Add your camera

1. In the Scrypted web UI, click **Plugins** → **Aqara Plugin** → **Add Device**.
2. Fill in:
   - **Name:** any friendly name (e.g. *Front Door*).
   - **IP Address:** your camera's LAN IP (from the Aqara Home app).
   - **RTSP Username** and **RTSP Password:** the ones generated when you enabled **RTSP LAN Preview**.
3. Open the newly added camera from the **Devices** list and confirm the live preview works.
4. *(Optional)* Set up doorbell ring events — see [Doorbell ring events](#doorbell-ring-events) below.

## Updating

Scrypted checks for plugin updates automatically. When a new version is available, a badge appears on **Plugins** → **Aqara Plugin**; click the update button and Scrypted pulls the new version from npm and restarts the plugin. Your camera configuration is preserved.

## Uninstalling

**Plugins** → **Aqara Plugin** → ⋮ menu → **Uninstall**. This removes the plugin and all cameras you added through it.

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

## Development

Only needed if you're contributing a code change or running an unreleased version. Regular users should use the **Install** section above.

Requires [pnpm](https://pnpm.io) 10+ and Node.js 24+.

```bash
pnpm install
pnpm run build
pnpm run scrypted-deploy <your-scrypted-host>
```

Other useful scripts: `pnpm test` (vitest), `pnpm run lint`, `pnpm run typecheck`, `pnpm run dev` (rebuild on change).

E1 transport tests use a loopback UDP camera simulator and send no commands to real cameras. The development build produces `out/plugin.zip`; `NODE_ENV=production pnpm run build` produces `dist/plugin.zip` for distribution. The E1 extension must be deployed from this checkout until a version containing it is published.

Issues and pull requests welcome on the [GitHub repo](https://github.com/DTse/aqara-scrypted).
