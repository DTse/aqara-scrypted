---
name: Alternate paths to get G410 ring events
description: Non-LAN options when/if plugin-native LAN detection stays impossible — Matter Signal Sync and rooting.
type: reference
originSessionId: 4ea70431-faa1-4533-b863-aac68bd7fbd7
---
If the main-APK jadx pass confirms G410 ring events are not emitted over LAN (or are emitted in a form that can't be decoded without per-device keys), two fallbacks exist:

**1. Matter Signal Sync (officially supported, user-setup required):** Aqara Home → Profile → Connected Ecosystems → Matter → Scene and Signal Sync → Signal Management → create "when doorbell is pressed" → save. This materializes a virtual Matter `BooleanState` / `OccupancySensing` cluster on the G410's Matter bridge. HA exposes it as `event.aqara_g410_..._video_doorbell_ringing`. HA core issue #153274 + OpenHomeFoundation #84 confirm raw Matter pairing of G410 only exposes `Identify` cluster — Signal Sync is the official workaround pending Matter 1.5 video-doorbell device type.

**2. niceboygithub/AqaraCameraHubfw rooting (confirmed working, user-hostile):** G410 model IDs `lumi.camera.acn017` (CN) / `lumi.camera.agl006` (global). Patched firmwares `4.5.20_0026.0092` and `4.5.20_0038.0102`. Flash `modified/G410/uboot/` + `rootfs_<ver>_modified.sqfs` via microSD with front button held; LED purple = reflashing. After boot, telnet 23 is open, no password. Edit `/etc/mosquitto/mosquitto.conf` → `listener 1883 0.0.0.0` + `allow_anonymous true`. Subscribe `#`. Doorbell presses appear on topic `ioctl/recv` as JSON containing a `res_name` field. Reference parser: `niceboygithub/AqaraGateway/custom_components/aqara_gateway/core/{gateway.py,utils.py}` with the `GLOBAL_PROP` table. Internal daemons: `ha_master`, `ha_basis`, `property_service`, `zigbee_agent`.
