# Testing Conventions

## Framework

- **Vitest** (not Jest, not `node:test`). `pnpm test` runs `vitest run`; `pnpm run test:watch` is the dev loop.
- **Node environment by default.** This is a Node plugin — no jsdom, no browser mocks needed.

## Test organization

- **Co-locate tests:** `helpers.test.ts` next to `helpers.ts`, `protocol.test.ts` next to `protocol.ts`. Scrypted's webpack build skips them automatically (they're unreachable from `main.ts`).
- **One test file per source module.** Don't merge tests across modules.

## What to test

- **Every pure function** in `protocol.ts` and `helpers.ts`. These are cheap to test and form the correctness foundation of the plugin.
- **Every public method on `IntercomSession`** that can be exercised without a real socket — currently almost none. Live-network flows are validated manually via the `Test Intercom Connection` and `Play Test Tone` settings buttons.
- **Do not test `AqaraCamera` / `AqaraProvider` directly.** They extend `ScryptedDeviceBase`, which requires a Scrypted runtime. Instead, extract the logic worth testing into pure helpers and cover it there.

## Conventions

- **Import `test` and `expect` explicitly:**
  ```ts
  import { test, expect } from 'vitest';
  ```
  Globals are NOT enabled in this project.
- **Test naming:** `'<subject>: <behaviour>'`. Plain English after the colon, no "Should" prefix.
  ```ts
  test('buildRtspUrl: encodes special characters in credentials', () => { ... });
  test('parsePacket: rejects bad CRC', () => { ... });
  ```
- **Matchers:**
  - `toBe(...)` for primitives and reference equality.
  - `toEqual(...)` for deep structural equality (including buffers, arrays, objects).
  - `toMatchObject(...)` when you only want to assert a subset of fields.
  - `toBeNull()` / `toBeUndefined()` / `toBeTruthy()` / `toBeFalsy()` for null/undefined checks.
  - `toThrow(regex_or_class)` for expected errors.
  - `toHaveLength(n)` for arrays.
- **Real data over mocks.** Use real `Buffer` instances, real CRCs, real protocol bytes captured from the camera (e.g. `feef02000100dc70` for the ACK). Don't synthesize fake versions.
- **Avoid `vi.mock(...)`** unless there is no pure alternative. If you're tempted to mock something, the usual fix is to extract the pure part into a helper and test that.

## Coverage expectations

- **100% of pure codec / helper code.** The round-trip (build → parse) test is mandatory for every packet type.
- **All rejection cases for validators.** If `parsePacket` can return `null`, each reason why (short buffer, bad magic, unknown type, truncated payload, bad CRC) needs its own test.
- **Edge cases in regex-based parsers.** For `parseRingEndpoint` and similar, test: happy path, trailing slash, query string, embedded in longer path, invalid chars, empty/undefined, too-short, too-long.

## Running

```bash
pnpm test            # single run, CI mode
pnpm run test:watch  # dev loop with file watcher
```

Tests must pass before any merge or release. CI enforces this (`.github/workflows/ci.yml`).
