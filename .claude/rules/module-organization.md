# Module Organization

## Layout

```
src/
├── main.ts              # plugin entry — re-exports AqaraProvider as default
├── provider.ts          # AqaraProvider (DeviceProvider + DeviceCreator)
├── camera.ts            # AqaraCamera (VideoCamera, Intercom, BinarySensor, HttpRequestHandler)
├── intercom-session.ts  # IntercomSession (TCP + UDP + ffmpeg pipeline, pure-ish)
├── protocol.ts          # pure LmLocalPacket codec, CRC, RTP, ADTS — no I/O
├── helpers.ts           # small pure helpers extracted from classes for testability
├── protocol.test.ts     # co-located unit tests (vitest)
└── helpers.test.ts
```

## Principles

- **Flat `src/` layout.** No nested subdirectories until file count demands it (~15+ files). Prefer filename disambiguation.
- **One primary export per file.** `camera.ts` exports `AqaraCamera`; `provider.ts` exports `AqaraProvider`. Helper types co-exported from the same file if tightly coupled.
- **Pure ≠ impure.** Keep side-effect-free code (codec, helpers) in separate files from code that owns sockets, processes, or Scrypted state. This is the single biggest testability lever we have.
- **No circular imports.** Provider → Camera → helpers/protocol is a DAG. Don't import Provider from Camera.
- **Test files co-located as `*.test.ts`.** They are excluded from the published tarball by webpack's entry graph (not reachable from `main.ts`).

## Where new code goes

- **Is it pure (no sockets, no `this.storage`, no Scrypted SDK calls)?** Put it in `helpers.ts` (or a new pure module) and add vitest tests.
- **Does it own a network socket, child process, or long-lived state?** Put it in its own class file (like `intercom-session.ts`) and inject dependencies via constructor.
- **Does it implement a Scrypted interface on the camera?** Add a method to `AqaraCamera`. Keep the body short — delegate to pure helpers where possible.
- **Is it provider-level (managing device lifecycle)?** Put it in `AqaraProvider`.

## Avoid

- **Barrel exports** (`index.ts` that re-exports everything) — they break tree-shaking and add a navigation hop.
- **"Utils" grab-bags.** Group by domain: `helpers.ts` currently holds RTSP/webhook/channel utilities because they're all camera-setting-adjacent. Split into new files before the file grows past ~300 lines.
- **Creating new top-level directories** (`services/`, `utils/`, `lib/`) without concrete demand. Flat works until it doesn't.
