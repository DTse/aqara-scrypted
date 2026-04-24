---
name: User prefers zero-user-input fixes
description: Don't propose user-action workarounds (Rebroadcast overrides, pasting flags, camera-setting tweaks) as the primary solution; build the fix into the plugin.
type: feedback
originSessionId: 7e86c8b6-0aa2-4010-b85e-45d62db65fc6
---
When I proposed "paste `-use_wallclock_as_timestamps 1` into Rebroadcast's
FFmpeg Input Arguments setting" as a workaround, the response was
"I need something that doesn't need user input. Can't you set the flags
correctly?" — which pushed us toward the embedded RTSP relay (1.1.0).

**Why:** The plugin targets non-technical end users (the goals.md says
"zero-build install, add a camera in under two minutes"). Any fix that
requires them to dig into another plugin's advanced settings breaks that.
It also rots — a Scrypted update could rename or relocate the setting.

**How to apply:** When diagnosing a user-reported bug, present
plugin-internal fixes first. External-configuration workarounds are
acceptable as temporary suggestions while a real fix is in flight, but
lead with what the plugin can do on its own. If the only fix is outside
the plugin, say so explicitly and treat it as a limitation to document,
not a shipped solution.

**Corollary:** this user is comfortable with substantial internal
refactors (accepted a ~500-line RTSP relay in the plugin, including a
port of go2rtc's timestamp-synthesis algorithm) when the alternative is
asking users to configure things. Don't shy away from scope if it removes
user burden.
