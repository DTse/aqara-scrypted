# Recommended Practices

## General

- **Destructure** objects and arrays rather than accessing by dotted path — except when the path is part of a sustained type-narrowing chain.
- **Lint-clean is the bar.** Never suppress ESLint with `eslint-disable` unless there's a concrete reason documented in an inline comment.
- **No new deps without weighing** bundle size, maintenance status, and whether Scrypted SDK or Node built-ins already cover it. This plugin bundles into `plugin.zip` and runs inside Scrypted's plugin host; every megabyte counts.
- **Prefer Node built-ins** over packages: `node:crypto` over `bcrypt`, `node:net` over wrappers, `node:http` over axios (unless a feature like streaming actually needs it).

## Error handling

- **Every `async` path handles rejections.** No floating promises. Either `await`, `.catch`, or prefix with `void` if you genuinely don't care about completion.
- **Log errors on the device console** (`this.console.error(...)`) when inside a `ScryptedDeviceBase`. For pure helpers, accept a `Console`-typed logger via the constructor and log through that.
- **Don't swallow errors silently.** If a catch block is empty, the next line must be a comment explaining why.
- **Fail fast at boundaries.** Validate settings (camera host, RTSP credentials) when first used and throw a descriptive Error; don't let a cryptic `ECONNREFUSED` surface five layers up.

## Scrypted plugin specifics

- **Always call `release()` / `stop()` on session-lifetime resources** — child processes, sockets, timers. Scrypted re-creates device instances on plugin reload; leaks persist across reloads until the plugin host restarts.
- **Don't re-announce devices on every change.** Only call `deviceManager.onDeviceDiscovered(...)` when interfaces or metadata actually changed.
- **Storage is async-free.** Treat `storage.getItem` / `setItem` as synchronous on the call site — they are. Don't wrap in promises.
- **Settings UI groups** map to collapsible sections in Scrypted's UI. Use them to keep the page scannable (current groupings: ungrouped main camera settings, "Doorbell Ring Events", "Intercom (diagnostic)").
- **Respect Scrypted's type system.** If a method is documented as returning `Promise<Setting[]>`, return exactly that shape — deviations break Scrypted's IPC marshalling silently.

## Anti-patterns to avoid

- **Mocking Scrypted SDK in tests.** Extract pure helpers and test those instead.
- **Reintroducing the raw-multicast ring detection.** Proven impossible on G410 (see `CLAUDE.md` architectural decisions + `.claude/memory` investigation notes).
- **Re-running jadx on a fresh Aqara APK version.** Same outcome (SecNeo wall) as v4.3.1 / v5.0.0 / v6.1.5 unless new evidence says otherwise.
- **Adding React / UI frameworks.** Scrypted plugins have no direct UI; settings render via the built-in Scrypted web UI. Anything that smells like frontend belongs in a separate project.
- **Reaching through Scrypted private APIs.** If an SDK method isn't exported, don't monkey-patch or import from subpaths; raise an issue upstream or find another approach.

## Code quality gates

Before declaring a task done:

```bash
pnpm run typecheck  # must exit 0
pnpm run lint       # must exit 0
pnpm test           # all tests pass
pnpm run build      # webpack bundles cleanly
```

And the blocker from `CLAUDE.md`: **update `CHANGELOG.md`** under the current in-progress version header.
