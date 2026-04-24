---
name: G410 RTSP stream quirks
description: Firmware-level oddities in the Aqara G410's RTSP/RTP output that downstream code has to compensate for.
type: project
originSessionId: 7e86c8b6-0aa2-4010-b85e-45d62db65fc6
---
Observed directly from the G410 at `rtsp://camera:8554/ch1` (and `/ch2`, `/ch3`):

**1. RTP timestamps are unset.** All RTP packets ship with PTS = DTS = 0 (or
the same constant value). FFmpeg logs
`[rtsp @ ...] Timestamps are unset in a packet for stream 0` and `-fflags
+genpts` can't recover because both PTS and DTS are absent — `+genpts`
synthesises PTS from DTS when only PTS is missing.

This cascades into Scrypted's Rebroadcast logging `Unable to find sync
frame in rtsp prebuffer`, session restarts, and audio dropouts. Fixed in
1.1.0 by the local RTSP relay that rewrites timestamps at the RTP layer.

**2. G410 SDP assigns PT 96 to audio, PT 97 to video** — the opposite of
what most RTSP servers do, and the opposite of what Rebroadcast's own
re-emitted SDP output shows (Rebroadcast's FFmpeg renumbers to 96=video,
97=audio). When diagnosing relay behaviour, trust the "Input #0" block
from Rebroadcast's FFmpeg log (which reflects the camera's original SDP),
not the "Output #0" block.

Encoding details:
- PT 96: `MPEG4-GENERIC/16000/1` (AAC-LC, 16 kHz, mono). `fmtp`: `mode=AAC-hbr`, `sizelength=13`, `indexlength=3`, `indexdeltalength=3`, `config=1408`.
- PT 97: `H264/90000`, Main profile, `profile-level-id=4D0033`.
- Video: 20 fps. Main: 1600x1200. Sub (ch3): 640x480. Medium (ch2): 1280x720.

**3. AAC frame size is 1024 samples per packet** (AAC-LC standard). The
RTP timestamp fixer uses this as the minimum advance per packet for
payload-type 96; any wall-clock-only synthesis causes libopus downstream
to report `Queue input is backward in time` when the camera sends packets
in bursts (happens at stream start).

**4. Intercom talkback at `192.168.10.224:54324` (TCP control) + `:54323`
(UDP RTP audio-out)** expects AAC-LC 16 kHz mono in ADTS framing. See
`intercom-session.ts` for the working handshake (START_VOICE → ACK → RTP
push). Unrelated to the RTSP stream but worth recording alongside.

**How to apply:** When someone reports choppy audio / visual artifacts on
a G410 stream, these three items (unset timestamps, swapped PT, AAC
1024-sample frames) are almost always the root cause. Don't diagnose from
Rebroadcast's re-emitted SDP alone.
