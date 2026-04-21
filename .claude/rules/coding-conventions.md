# Coding Conventions

## Functions first

- **Always prefer arrow functions** over `function` declarations at module scope. `const foo = () => { ... }` beats `function foo() { ... }`.
- **Classes are allowed only when required by an external contract** — concretely:
  - Anything extending `ScryptedDeviceBase` or another Scrypted SDK base (SDK forces class semantics via `this`).
  - Long-lived stateful sessions with a multi-method lifecycle where a factory + closures would be strictly less readable (e.g. `IntercomSession`).
- For everything else, reach for a plain arrow function or a factory returning a closure. Don't create a class for a grab-bag of statics.

## Consolidated exports at end of file

- **Do not use inline `export` keywords** on declarations. No `export const foo = ...`, no `export function foo()`, no `export class Foo {}`, no `export interface Foo {}`, no `export type Foo = ...`.
- **Every module ends with a single `export { … }` block** listing everything the module exposes. Type-only exports use the inline `type` marker:
  ```ts
  const MAGIC = Buffer.from([0xfe, 0xef]);
  const buildPacket = (type: number, value: bigint): Buffer => { ... };

  interface ParsedPacket { ... }

  export { MAGIC, buildPacket, type ParsedPacket };
  ```
- **Default exports are OK** for the plugin entry point (`main.ts`) and `export { … } from '…'` re-exports. Everywhere else, named exports only.
- **Rationale:** one place to scan for a module's surface area; cleaner diffs when exports change; avoids the readability noise of `export` sprinkled on 12 different lines.
- ESLint's `perfectionist/sort-named-exports` will reorder the block automatically — don't hand-order it.

## TypeScript

- **Strict mode only.** Do not disable `strict` in `tsconfig.json`. Don't use `any` unless there's a concrete reason; document it inline if you must.
- **Prefer `interface` for object shapes, `type` for unions, intersections, and aliases.**
- **Readonly and narrow types where possible.** Use `as const` for literal arrays of IDs (e.g. `VALID_CHANNEL_IDS`).
- **Don't use `any` to silence errors.** If the types are genuinely unknown, use `unknown` and narrow. Non-null assertions (`!`) are acceptable but only when the invariant is obvious from surrounding control flow.
- **Use `import type` for type-only imports** when the TS config supports it, to keep bundle output clean.
- **No `@ts-ignore` / `@ts-expect-error`.** Fix the underlying type issue.

## Node / Runtime

- **Always `import { Buffer } from 'node:buffer'`** and use `Buffer.alloc` / `Buffer.from` / `Buffer.concat`. Never `new Buffer(...)`.
- **Use `node:` prefix for built-ins** (`node:net`, `node:dgram`, `node:child_process`, `node:crypto`, `node:buffer`).
- **`async`/`await` over `.then` chains.** Avoid floating promises — either `await`, assign to a variable that's awaited later, or prefix with `void` if genuinely fire-and-forget.
- **Never `return await`** unless you need a try/catch to observe the rejection — the function already returns a Promise.
- **Error handling:** every async path must handle rejection. Don't swallow errors silently; at minimum log via `this.console.error(...)` (inside a `ScryptedDeviceBase`) or a passed-in logger (inside a pure helper class like `IntercomSession`).
- **No `console.log` / `console.error` in device code.** Use `this.console.*` — Scrypted tags it with the device identity.
- **No `setTimeout` / `setInterval` without a cleanup path.** Every timer must have a matching `clearTimeout` / `clearInterval` in `release()` / `stop()` / the equivalent cleanup method.

## Control flow

- **Max nesting depth of 2** for conditions, loops, switches. Rethink the function if it goes deeper — usually early returns or helper extraction solves it.
- **Early returns over nested if-else.** Validate preconditions first and return/throw; keep the happy path flat.
- **Avoid `switch` for dispatch.** Prefer object literals or a `Map` for type-safety and easier extension:
  ```ts
  const handlers: Record<string, () => void> = { ... };
  handlers[key]?.();
  ```
- **Prefer `.map` / `.filter` / `.reduce` / `for…of` over index-based `for` loops.**

## Scrypted SDK specifics

- **Use SDK types verbatim**, don't re-declare interface shapes. Import from `@scrypted/sdk`: `Setting`, `HttpRequest`, `FFmpegInput`, `ScryptedInterface`, etc.
- **Device classes extend `ScryptedDeviceBase`.** State properties (`binaryState`, `motionDetected`, `online`) go directly on `this` — Scrypted intercepts the setter and fires events.
- **`this.storage`** is the only persistent store for device config. Keys are strings; values are stringified automatically. Don't shadow or cache it.
- **Settings:** return a flat array from `getSettings()`. Use the `group` field to bucket related settings. Buttons use `type: 'button'` and fire through `putSetting(key, undefined)`.
- **Interface declarations on the class must match the `Device.interfaces` array** in `createDevice` / `resyncDevices`. Out of sync = Scrypted won't route calls correctly.
- **HTTP endpoints** use `HttpRequestHandler` per-device. URL is derived via `endpointManager.getLocalEndpoint(nativeId, { public: true, insecure: true })`.

## Formatting

- **Follow ESLint + Prettier output.** `pnpm run lint:fix` autofixes the easy cases. Do not suppress fixable warnings.
- **Single quotes, 4-space indent, trailing commas where valid** — enforced by Prettier config.
- **Object property order** is enforced by `eslint-plugin-perfectionist`. Follow the lint output; don't hand-order.
