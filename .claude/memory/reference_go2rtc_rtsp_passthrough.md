---
name: go2rtc's RTSP server output is a timestamp passthrough
description: Evidence that embedding go2rtc would not have fixed the G410 choppy-audio problem via Scrypted's RTSP consumption path.
type: reference
originSessionId: 7e86c8b6-0aa2-4010-b85e-45d62db65fc6
---
**go2rtc only rewrites timestamps on its MP4/MSE/WebRTC outputs — not on
its RTSP server output.** Verified in source:

- `pkg/rtsp/consumer.go:95-110` — the `packetWriter` closure that every
  outbound RTSP sender runs copies `packet.Timestamp` verbatim from
  upstream. No clamp, no accumulator, no zero-check.
- `pkg/mp4/muxer.go:121-156` — this is where the DTS synthesis lives
  (`duration == 0 || duration > codec.ClockRate` clamp, independent
  `m.dts[trackID]` accumulator). Only MP4/MSE/WebRTC consumers reach it.
- `pkg/core/track.go:29-37` — `Receiver.Input` fan-out is also a raw
  passthrough.

**Why AlexxIT/WebRTC works on broken cameras:** because it consumes go2rtc
via WebRTC (MSE/MP4 path), not RTSP.

**Why this mattered for us:** when evaluating "should we embed go2rtc to
fix the G410", the answer was no — Scrypted's Rebroadcast consumes via
RTSP, and go2rtc's RTSP out wouldn't have fixed the timestamps. We had to
port the synthesis logic ourselves into our own relay at the RTP layer
(the 1.1.0 approach in `src/rtp-timestamp-fixer.ts` + `src/rtsp-relay.ts`).

go2rtc's own FFmpeg transcoding path (`internal/ffmpeg/ffmpeg.go:253`)
uses `-use_wallclock_as_timestamps 1` — but that's a different codepath
from the one AlexxIT/WebRTC users hit.

**How to apply:** If a future conversation asks "why not just use
go2rtc?", this is the answer. Embedding the binary still wouldn't have
solved the problem through the only protocol Scrypted accepts (RTSP).
