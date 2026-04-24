# CLAUDE.md

Guidance for Claude Code when working in this repo. Read every session.

## 📖 Mandatory rules — `.claude/rules/` (read first, apply always)

Before making **any** change, read the full rules set in `.claude/rules/`. These are not suggestions; they are the project's binding conventions. The rule files are:

- [`.claude/rules/core.md`](.claude/rules/core.md) — persona, approach, verification, safety, and error-handling philosophy.
- [`.claude/rules/goals.md`](.claude/rules/goals.md) — what this plugin is for and its non-goals.
- [`.claude/rules/coding-conventions.md`](.claude/rules/coding-conventions.md) — TypeScript + Node + Scrypted SDK coding rules.
- [`.claude/rules/naming-conventions.md`](.claude/rules/naming-conventions.md) — names for classes, functions, constants, files, tests.
- [`.claude/rules/module-organization.md`](.claude/rules/module-organization.md) — `src/` layout and where new code belongs.
- [`.claude/rules/testing.md`](.claude/rules/testing.md) — vitest conventions, pure-helper extraction pattern, coverage expectations.
- [`.claude/rules/documentation.md`](.claude/rules/documentation.md) — TSDoc, inline comments, protocol RE annotations, README/CHANGELOG policy.
- [`.claude/rules/recommended-practices.md`](.claude/rules/recommended-practices.md) — general Node/TS practices, Scrypted specifics, anti-patterns, quality gates.
- [`.claude/rules/security.md`](.claude/rules/security.md) — webhook tokens, credentials, network boundaries, logging hygiene, publishing.

If a rule conflicts with a user instruction in the moment, surface the conflict explicitly before proceeding. If a rule conflicts with another rule, `security.md` > `core.md` > everything else.

When updating code, update the matching rule file if conventions shift. Rule updates go in the same changelog entry as the code change.

## 🚫 Blocker — update `CHANGELOG.md` on every change

**Any code, config, workflow, or documentation change requires an entry in
`CHANGELOG.md` under the current in-progress version header** (e.g.
`## [1.0.1] - YYYY-MM-DD`). This is not optional — a patch is not "done"
until the changelog reflects it.

- **Always use a version header, never `## [Unreleased]`.** The current
  in-progress version is the top `## [X.Y.Z] - DATE` entry in the file.
  Check `package.json`'s `version` field if unsure — it should match.
- **Never add changes to a version that has already shipped to npm.**
  Once a version has been released — meaning it's been tagged and
  published — its CHANGELOG entry is frozen. Any subsequent change goes
  in a **new** version section at the top of the file. Signs a version
  has shipped: the CI release workflow ran successfully for its tag, the
  user confirmed the release, or `npm view aqara-scrypted version`
  matches the most-recent CHANGELOG header. When in doubt, ask.
- **Creating a new version section is OK** when the previous one is
  frozen. Use today's date and leave `package.json` at the next semver
  bump (the user will reconcile `package.json` with the new header before
  tagging). Pick the bump level based on content: `### Fixed` only →
  patch (1.0.5 → 1.0.6); `### Added` or `### Changed` compatible →
  minor; breaking → major.
- Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) subsections:
  `### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Deprecated`,
  `### Security`. Add the subsection under the version header if it doesn't
  already exist.
- Write the entry from the **user's perspective**, not the commit's. "Fixed
  intercom crash on RTSP reconnect" beats "refactored IntercomSession".
- If a change is genuinely not user-visible (e.g. a typo in a private
  comment), you may skip, but **err on the side of logging**.
- **Do not bump `package.json`'s version yourself** — the user does that
  when cutting a release. Your job is to keep the CHANGELOG honest.

When you finish any task, your checklist is: code ✅ → tests ✅ → changelog
entry ✅. Missing the third = not done.

## Verify before declaring a task done

Run these and confirm clean output:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

All four must pass. `pnpm test` runs vitest (~100 ms).

## Tooling constraints

- **Package manager: pnpm** (pnpm 10+). The `preinstall` script blocks `npm`
  and `yarn` via `only-allow pnpm`. Never run `npm install`, `npm ci`, etc.
- **Node 24+ required** (matches `@types/node ^25`; the release workflow
  pins Node 24 LTS).
- **`.npmrc` sets `node-linker=hoisted`.** Required so Scrypted SDK's
  `scrypted-webpack` / `scrypted-deploy` binary shims resolve correctly. Do
  not remove.
- **Tests live next to source** as `*.test.ts` files, run via vitest.
  Skip mocking the Scrypted SDK — pull pure helpers out into `src/helpers.ts`
  (or similar) and test those. `AqaraCamera` / `AqaraProvider` /
  `IntercomSession` classes require a Scrypted runtime and aren't unit
  tested.

## Publishing

- Releases are tag-triggered: `git tag X.Y.Z && git push --tags` (bare
  semver, **no `v` prefix**) → the `release.yml` workflow publishes to
  npm and creates a GitHub release.
- Publishing uses **npm Trusted Publishing (OIDC)** — there is no stored
  `NPM_TOKEN` secret. Do not reintroduce one.
- Before suggesting a tag, confirm `package.json` version matches the target
  tag and that `CHANGELOG.md` has a `## [X.Y.Z] - DATE` heading (the
  workflow's awk matches on exactly this pattern).

## Architectural decisions already made — don't re-litigate

These came out of prior investigation; do not reopen without new evidence:

- **Ring events cannot be detected from the Aqara LAN protocol directly.**
  G410 migrated to an encrypted ECDH+AES tunnel (`com.aqara.lanlink.Tunnel`)
  whose Java side is locked in a SecNeo-shielded DEX. jadx on v4.3.1 / v5.0.0
  / v6.1.5 only reveals the wrapper classes. dxfx doesn't cover this SecNeo
  variant. No public reverse-engineering exists (verified April 2026).
- **Ring events flow through a webhook** fired by the user's own Matter
  controller (HA / Apple Home / etc.), not through Scrypted directly,
  because Scrypted has no Matter controller plugin.
- **Motion detection is not in scope** for this plugin. Point users at
  `@scrypted/objectdetector` on the video stream.
- **The webhook endpoint is per-camera** with a stored token, implemented
  via `HttpRequestHandler` on the camera device (not the provider).

Full context for the above lives in `.claude/memory/` (checked into the repo). Start at `.claude/memory/MEMORY.md` for the index. The auto-memory directory at `~/.claude/projects/.../memory` is symlinked to this path, so any memory Claude Code writes during a session lands in the repo too.

## Working style

- Keep suggestions short, match the user's terseness. Lead with the decision,
  then the reason.
- Don't propose adding features, abstractions, or deps unless they address a
  concrete stated need.
- When making user-facing changes, update both README (if relevant) and
  CHANGELOG (always).
