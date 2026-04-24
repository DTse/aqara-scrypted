---
name: Aqara Home APK jadx findings (v6.1.5)
description: What jadx extracted from the Aqara Home APK, the SecNeo shielding wall, and the `com.aqara.lanlink.Tunnel` lead.
type: project
originSessionId: 4ea70431-faa1-4533-b863-aac68bd7fbd7
---
Decompiled `com.lumiunited.aqarahome.play` v6.1.5 (6489) from APKPure. Source tree was only 2.9 MB because **the APK is shielded with SecNeo/Bangcle** — the real DEX lives encrypted in `lib/armeabi-v7a/libdatajar.so` (143 MB) and is decrypted at runtime by `libDexHelper.so` + `libdexjni.so`. Only 4 packages survived jadx: `com.alibaba.android.arouter.routes` (route registry), `com.lumiunited.aqarahome.play` (R.java only), `com.secneo.apkwrapper`, and `kotlin.coroutines.jvm.internal`. The AndroidManifest is NOT shielded and contains real class names.

**Why:** User wants to revive ring-event detection removed in commit 36299a8. Prior session proved G410 sends no press-correlated raw UDP/TCP traffic on channels the plugin was watching. APK analysis was the last open lead. The jadx pass answered the key architectural question even though Java bytecode is unreadable.

**How to apply:** Any future ring-event work must account for these findings:

1. **Ring events do NOT travel on raw multicast or unauthenticated TCP.** They travel through `com.aqara.lanlink.Tunnel` — a full ECDH+AES-CTR/CBC encrypted bidirectional tunnel. JNI symbols confirm: `Java_com_aqara_lanlink_Tunnel_Start / Stop / Talk / Incoming / Outgoing` plus Java callbacks `onTunnelEvent`, `onTunnelWrite`, `onTunnelRead` (all `([B)V`). Strings in `liblanlink.so` (only 110 total, 18 KB lib): `ecdh_generate_keys`, `ecdh_shared_secret`, `base_x/base_y/base_order/coeff_b/polynomial`, `AES_init_ctx_iv`, `AES_CBC_encrypt_buffer`, `AES_CTR_xcrypt_buffer`, `tunnel_new/tunnel_delete`.

2. **The Tunnel is transport-agnostic in C** — Java owns the socket; C only does framing + crypto. Therefore no port strings are present in the `.so`. The port/handshake sequence lives in the SecNeo-shielded Java. This explains why the prior wide UDP/TCP scan couldn't find the channel: without ECDH kickoff, the camera doesn't send anything.

3. **`com.lumi.lumidevsdk.LumiDevSDK`** (`liblumidevsdk.so`, 1 MB Rust library by "joeychang") provides the crypto helpers used to talk to the cloud and presumably to bootstrap the tunnel auth: `aesEncryptedContent`, `aesDecryptedContent`, `getCameraSign`, `getCert`, `getDecryptedInfo`, `getDevicePairMessage`, `getEncryptedInfo`, `getSignHead`. Uses Rust `aes-0.7.5`/`aes-soft-0.6.4` + `block-padding-0.2.1` + ECDH. No transport code here either.

4. **`com.lumi.ed.AqaraED`** (`libaqara_ed.so`, 15 KB) is a small encode/decode helper (`create/destroy/encode/decode` JNI), 16k-aligned memory. Bangcle markers (`__b_a_n_g_c_l_e__check1234567_`). Probably generic cipher context, not specific to ring events.

5. **ARouter registry revealed** the key activity: `/lm_camera/AQARA_LOCAL_CAMERA_ACTIVITY` → `com.lumi.module.camera.LocalCameraActivity` with params `rtsp-url-map` (serializable), `config` (parcelable), `lan-ip` (string). That's the LAN-only camera screen the G410 uses. The class is shielded.

6. **Ring/ringtone classes visible in manifest are ringtone MANAGEMENT, not ring events:** `com.lumiunited.aqara.ring.view.{RingRecordActivity, LinkageRingMainActivity, ChooseLocalAudioActivity}`, `com.lumiunited.aqara.ring.service.RingUploadService`. The ARouter `ringtone` group confirms it. Do not chase these expecting event wiring.

7. **No `DynamicLoader`/CDN-plugin-download code visible** (as suspected would exist in prior session). With SecNeo, we can't rule it out but have no positive evidence either way. The `f6ac75d9_6e5c6484cb8626d86d7434f7ae4e20fc` asset in `assets/` is a plain zip of UI theme/widget PNGs from 2023 — not a device plugin.

**Next steps to break the SecNeo wall (ranked):**
- (a) ~~Find a pre-SecNeo Aqara Home APK on apkmirror — earlier versions may have the Java plaintext.~~ **Ruled out 2026-04-21:** v4.3.1, v5.0.0, and v6.1.5 are all SecNeo-packed (same 173KB wrapper `classes.dex` + big `libdatajar.so` + `libDexHelper/libdexjni`). Would need v3.x or older, and no guarantee of plaintext or of G410-compatible Tunnel code.
- (b) Unpack the SecNeo DEX. In order of effort (2026):
  - ~~**quarkslab/dxfx**~~ **Tested 2026-04-21, does NOT work on Aqara v6.1.5.** Same SecNeo family (confirmed by shared hardcoded DJI pre-DEX key `66976ce86d4638b0095aa5d70fcb9aa0` at offset 520280 in Aqara's `libDexHelper.so`, and shared S_TABLE_SIG `dfc9df83c2c9ced9c0cdf3cddcdc82c8` at offset 561239), but a fundamentally different **payload layout**: dxfx expects encrypted chunks in `classes.dex` marked `cdf236dd` + an `assets/classes.dgc` code pool; Aqara has neither. Instead Aqara embeds ONE monolithic ~143 MB encrypted blob as the `.data` section of `lib/armeabi-v7a/libdatajar.so` (ELF symbols `_binary_dexdata0_start/end/size` — classic `objcopy -B binary` fingerprint). dxfx would need to be largely rewritten to handle this variant, including reversing `libDexHelper.so` to learn how the monolithic blob is chunked/decrypted. Multi-day RE task, unpublished as of search on 2026-04-21.
  - **JEB Pro Generic Unpacker** (pnfsoftware.com) — commercial, polished static unpacker, same target class as dxfx.
  - **Alexjr2/Android_Dump_Dex** Frida script on rooted Android — actively maintained, SecNeo-aware, hooks `android_dlopen_ext`. Use if static unpackers can't finish the job.
  - **BlackDex v3.2** (2025-01) and **strazzere/android-unpacker** (2014) do NOT work against modern Aqara SecNeo — verified by external reports and by the 2014 tool's lack of a `libDexHelper` module. No Play Store unpacker exists (Google removes them).
- (c) MITM/Wireshark while the Aqara app opens a camera: watch for the ECDH handshake pattern to at least identify the transport port.
- (d) Accept the wall, ship Matter Signal Sync as the documented path (see `reference_ring_alternatives.md`).

**Web-search status (2026-04-21):** ~14 targeted searches across GitHub, HA forums, XDA/4PDA, Chinese RE sites (看雪/52pojie). Zero public reverse-engineering of `com.aqara.lanlink.Tunnel`, zero reimplementations (no `tunnel.py`/`lanlink.py`), zero unpacked Aqara APK dumps, zero mention of the port the encrypted Tunnel opens on. absent42's G400 work (`com.lumi.module.rtsp` + `LmLocalPacket`) is confirmed as the predecessor protocol Aqara abandoned for newer cameras — G410 migrated to `com.aqara.lanlink` + `LumiDevSDK` crypto, and the opcode/packet-layout from absent42's work does NOT carry forward. If/when we RE the Tunnel we are genuinely first.

Decompile artifacts (ephemeral, /tmp — re-run `jadx -d /tmp/aqara-jadx com.lumiunited.aqarahome.play.apk` if gone):
- `/tmp/aqara-jadx/` — jadx output (sources + resources)
- `/tmp/aqara-native/lib/armeabi-v7a/{liblanlink.so, liblumidevsdk.so, libaqara_ed.so}` — extracted from `config.armeabi_v7a.apk`
- `/tmp/aqara-rnbundle/android_base/base.bundle` — the plaintext RN JS framework bundle (3.7 MB, UI-only, no protocol code)
