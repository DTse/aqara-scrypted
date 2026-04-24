---
name: Ring event investigation state (G410)
description: What has been proven about Aqara G410 ring/doorbell LAN events, what was removed, and what's still open.
type: project
originSessionId: 4ea70431-faa1-4533-b863-aac68bd7fbd7
---
`fix: remove motion and ring` (commit 36299a8) reverted the ring-detection code because detection via the LAN multicast was proven impossible under the approaches tried. Motion was always unsupported; only ring is the live target to revive.

**Why:** Prior session (Apr 19 transcript at `/Users/dimitris/.claude/projects/-Users-dimitris-Desktop-Projects-nosync/6e8d1164-be8d-42ac-9273-43819aa09ba2.jsonl`) verified:
- Multicast `230.0.0.1:10008` carries only 30.0 s heartbeats (208-byte UDP). Bytes 0–32 shared across devices, 32–112 per-sender constant, 112–208 rotate (likely AES-GCM 16 IV / 64 ct / 16 tag). No press-correlated packet in 3 test presses.
- Wide-capture across 10 sockets (lumi 10007/10008/10009, lumi-sub 224.0.0.50:9898/4321, miIO 54321/54322, SSDP 1900, CoAP 224.0.1.187:5683, aqara-event 9877) — only 10008 fires, on heartbeat cadence.
- TCP port probe: only 54324 (`LmLocalPacket`) is open; it ACKs and closes in 0.08 s. No unsolicited push during presses.
- `LmLocalPacket` types 0–3 documented (START_VOICE/STOP_VOICE/ACK/HEARTBEAT); parser rejects `>3`. A `Type=4/5` press packet would be silently dropped — but diagnostic logs raw hex pre-parse, so none was seen on 10008 either.

**How to apply:** Don't re-run the "any multicast packet = ring" or "burst of 2 packets in 3 s = ring" experiments — both are empirically disproven. The APK jadx pass was completed (2026-04-21) — see `project_apk_findings.md`. Key result: events travel through `com.aqara.lanlink.Tunnel`, an ECDH+AES encrypted tunnel whose Java socket-management code is locked inside a SecNeo-shielded DEX (`libdatajar.so`). The raw multicast/TCP scan couldn't see events because without the ECDH kickoff the camera sends nothing. Further progress requires either unpacking the DEX (Frida DEX-dump on a rooted device, or an older pre-SecNeo Aqara Home APK) or accepting the wall and shipping Matter Signal Sync — see reference memory.

Protocol constants worth preserving (also in `src/protocol.ts`): magic `0xFE 0xEF`, CRC-16/KERMIT poly 0x8408, 54324 TCP control, 54323 UDP RTP (AAC-LC), 10008 multicast 230.0.0.1.
