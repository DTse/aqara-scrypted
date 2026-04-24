---
name: RTSP relay state at end of 1.1.0 work
description: What got built for 1.1.0, what's still unresolved, and the next planned improvement.
type: project
originSessionId: 7e86c8b6-0aa2-4010-b85e-45d62db65fc6
---
**Shipped and working (uncommitted to npm as of 2026-04-24):**

- `src/rtp-timestamp-fixer.ts` — pure helper; per-track wall-clock +
  minAdvanceTicks synthesis. Tested.
- `src/sdp-parser.ts` — extracts `{encodingName, clockRate}` per PT from
  `a=rtpmap` lines. Tested.
- `src/rtsp-interleaved-parser.ts` — streaming parser for RTSP-over-TCP
  that emits complete text/binary items. Tested.
- `src/rtsp-relay.ts` — TCP proxy, one upstream per client session,
  rewrites RTP timestamps in flight, URL rewrite camera→client only
  (client→camera is verbatim to preserve Digest auth), 5-second backoff
  after ECONNREFUSED, RTSP 503 reply on upstream failure.
- `src/camera.ts` — `getVideoStream` returns `rtsp://user:pass@127.0.0.1:<relayPort>/<channel>`. `ensureRelay()` lazily starts/restarts on host/port change. `release()` stops the relay.

**Confirmed G410 behaviour through the relay:**
- Video works cleanly (1.1.0 fixed the initial "no sync frame" cascade).
- Audio initially had burst-start choppiness; fixed by per-codec
  `minAdvanceTicks` (AAC=1024, PCMU/A=160, Opus=960, video=clockRate/30).

**Unresolved at end of 2026-04-24 session:**

After extensive testing/reloads, the G410 started returning `ECONNREFUSED`
on port 8554 to the relay. Aqara app still worked (it uses cloud, not
LAN RTSP). Two suspected causes, both triggered by our earlier behaviour:

1. **RTSP session-table leak on the camera** — we destroy the TCP socket
   on session close but never send RTSP `TEARDOWN`. If the G410 firmware
   doesn't free session state on abrupt TCP close, the session table
   fills up and refuses new connections.
2. **Connection rate-limiter blacklist** — before 1.1.0's 5-second
   backoff was added, Rebroadcast's retry loop was pounding the camera.
   Some cheap-camera firmware blacklists the source IP for a while.

Both theories are reset by a **camera reboot**. User was asked to reboot
to confirm; outcome unknown at session close.

**Next planned improvement (to prevent recurrence):** send an RTSP
`TEARDOWN` to the camera before destroying the upstream socket in
`RelaySession.close()`. Requires tracking the session ID from the first
SETUP response the camera sends back. Small addition to the relay.

**Why:** So the camera's session table never grows unbounded and the
choppy-audio fix doesn't eventually wedge the camera itself. How to
apply: implement as a 1.1.1 patch on top of the 1.1.0 relay.

**Version state:** 1.0.7 published to npm. 1.1.0 is in the working tree
with the relay + related changes. CHANGELOG draft for 1.1.0 was dropped
in favour of leaving 1.0.7 as the most recent entry (see CHANGELOG.md) —
may need a fresh 1.1.0 or 1.0.8 entry when the relay ships. Do not
re-add the 1.0.7 FFmpeg-flag claim; it was proven ineffective.
