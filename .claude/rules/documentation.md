# Documentation

## TSDoc / JSDoc

Use TSDoc comments on **exported functions, classes, and types** when the signature alone doesn't convey intent — protocol codecs, cipher helpers, anything with non-obvious invariants.

```ts
/**
 * Parse a single packet from a buffer. Returns null on any validation failure
 * (bad magic, unknown type, truncated payload, bad CRC).
 */
export function parsePacket(data: Buffer): null | ParsedPacket { ... }
```

- **Describe the WHY and the invariants**, not the WHAT — TypeScript signatures already describe the WHAT.
- **Document rejection conditions** for parsers/validators explicitly (`Returns null when …`).
- **Don't document obvious properties.** A camelCase getter called `getDoorbellToken()` doesn't need "Gets the doorbell token."

## Inline comments

Default to writing NO comments. Add one only when the WHY is non-obvious:

- A hidden constraint (`// camera closes TCP 80ms after ACK — heartbeat must start immediately`).
- A subtle invariant (`// 1024 samples per AAC-LC frame at 16kHz`).
- A workaround for an external bug (`// -re paces lavfi at real time; without it ffmpeg blasts frames in milliseconds`).
- A magic constant's origin (`// 'feef02000100dc70' — captured ACK from G410`).
- A deliberate non-obvious choice (`// RC4 kept here only to match DJI's SecNeo variant`).

Do NOT:

- **Explain WHAT the code does** — well-named identifiers already do that.
- **Reference the current task, fix, or issue number** — those belong in the PR description and commit message; they rot as the codebase evolves.
- **Leave commented-out code.** Use git history; if something is intentionally preserved, write a `// TODO:` with a reason.

## Protocol / RE annotations

Protocol constants extracted from reverse-engineering MUST include an attribution comment:

```ts
// Reverse-engineered from the Aqara Android app (com.lumi.module.rtsp)
// and ported from https://github.com/absent42/aqara-doorbell (Python).
export const MAGIC = Buffer.from([0xfe, 0xef]);
```

This isn't for credit — it's so future-you can re-verify if the protocol changes.

## README and CHANGELOG

- **`README.md`** is for end users first (install via Scrypted UI, configure camera, set up ring events). A separate Development section at the bottom addresses contributors.
- **`CHANGELOG.md`** follows Keep a Changelog format. See the blocker rule in `CLAUDE.md` — every change requires an entry under the current in-progress version header.
- **Don't create new top-level docs** (`ARCHITECTURE.md`, `DESIGN.md`, `NOTES.md`) without a clear user or contributor need. README + CLAUDE.md + CHANGELOG.md + the `.claude/rules/` set should cover it.
