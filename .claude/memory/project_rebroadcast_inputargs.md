---
name: Rebroadcast discards camera plugin inputArguments
description: Critical fact about how Scrypted's Rebroadcast plugin builds its FFmpeg argv — any FFmpeg flags we put in FFmpegInput.inputArguments are silently overwritten.
type: project
originSessionId: 7e86c8b6-0aa2-4010-b85e-45d62db65fc6
---
Scrypted's `@scrypted/prebuffer-mixin` (the Rebroadcast plugin) **does not use
`ffmpegInput.inputArguments` from camera plugins** when the default
"FFmpeg (TCP)" / "FFmpeg (UDP)" parser is selected. Verified in source at
`plugins/prebuffer-mixin/src/main.ts:601-611` (koush/scrypted on GitHub):

```ts
if (!this.canUseRtmpParser(mso)) {
  if (parser === FFMPEG_PARSER_UDP)
    ffmpegInput.inputArguments = ['-rtsp_transport', 'udp', '-i', ffmpegInput.url];
  else if (parser === FFMPEG_PARSER_TCP)
    ffmpegInput.inputArguments = ['-rtsp_transport', 'tcp', '-i', ffmpegInput.url];
}
const extraInputArguments = userInputArguments || DEFAULT_FFMPEG_INPUT_ARGUMENTS; // '-fflags +genpts'
ffmpegInput.inputArguments.unshift(...extraInputArguments.split(' '));
```

Only `ffmpegInput.url` survives the rebuild. The final argv is:
`-fflags +genpts -rtsp_transport tcp -i <url>`.

**Why:** This is why the 1.0.7 `-use_wallclock_as_timestamps 1` fix shipped
and did nothing for users with Rebroadcast (i.e. most users). The flag was
overwritten before FFmpeg ever saw it.

**How to apply:** Any fix that needs to modify the stream *before* FFmpeg
demuxes it must happen server-side of the URL we return — i.e. in our own
RTSP relay (the 1.1.0 approach). Users *can* manually paste flags into
Rebroadcast's "FFmpeg Input Arguments" per-camera setting
(`ffmpegInputArgumentsKey` at line 608) — those *are* prepended. But that
requires user action.

The `tool: 'scrypted'` path (native parser) uses `startRtspSession` and
doesn't spawn FFmpeg at all; `inputArguments` is ignored there too.
