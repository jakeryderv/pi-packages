---
name: pi-package-authoring
description: Author, review, or maintain Pi coding-agent packages in this repo. Use when creating package resources, editing package.json pi manifests, adding extensions/skills/prompts/themes, changing npm publish contents, or preparing package preflight checks.
---

# Pi Package Authoring

Use this skill for package work in `pi-packages`.

## Core repo rules

- Root repo is private and never published.
- Publishable packages live under `packages/*` and publish independently.
- Each package needs:
  - `keywords: ["pi-package"]`
  - a `pi` manifest, unless conventional discovery is intentional
  - a tight `files` list
  - package-specific docs under `packages/<pkg>/docs/`
- Only package `README.md` ships by default. Internal `docs/` are git-tracked but
  excluded from npm tarballs unless intentionally added to `files`.

## Dependency rules

- Pi core imports go in package `peerDependencies` with `"*"`:
  - `@earendil-works/pi-coding-agent`
  - `@earendil-works/pi-ai`
  - `@earendil-works/pi-agent-core`
  - `@earendil-works/pi-tui`
  - `typebox`
- Runtime imports go in the package's `dependencies`, not root dev deps.
- Repo-only tooling stays in root `devDependencies`.
- Do not bundle Pi core packages.

## Extension rules

- Do not start sockets, servers, watchers, timers, or other background work in
  the extension factory.
- Start session-scoped resources in `session_start`, or lazily on first use.
- Tear resources down in an idempotent `session_shutdown` handler.
- Derive `~/.pi/...` paths with `CONFIG_DIR_NAME`:
  `join(os.homedir(), CONFIG_DIR_NAME, ...)`.
- Keep `index.ts` focused on Pi wiring; split store, manifest, server, and
  validation logic into small modules.

## Local project `.pi/` rules

- Keep `.pi/settings.json` for external, reviewed catalog packages only.
- Do not add in-repo packages such as `./packages/*` to `.pi/settings.json`.
- Test in-repo packages with `pi -e /absolute/path/to/packages/<pkg>`.
- Do not edit generated `.pi/npm/` or `.pi/git/` contents.

## Preflight before publish or handoff

Run from the repo root:

```bash
npm run typecheck
npm test
npm run format:check
npm run lint:md
npm run pack:artifacts -- --json
```

For package tarballs, confirm only expected runtime resources ship. For
`pi-artifacts`, docs and tests should remain excluded unless intentionally
changed.

## README/package files check

If package `files` excludes `docs/`, package README links should not point to
relative `docs/...` paths that will be broken on npm. Use GitHub URLs or include
`docs/` intentionally.
