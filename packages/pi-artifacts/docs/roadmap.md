# Visualization Artifacts Roadmap

This is the implementation roadmap for the first package in this repo: `@jakeryderv/pi-artifacts`. The pinned tool and manifest shapes live in [`./api.md`](./api.md), and the fuller product/design notes live in [`./notes/design.md`](./notes/design.md). Cross-cutting repo conventions (dependency placement, extension lifecycle, rebrand-safe paths) live in the repo-level [`packaging notes`](../../../docs/notes/packaging.md).

## Initial scaffold decisions

- Workspace package folder: `packages/pi-artifacts`.
- Published npm package: `@jakeryderv/pi-artifacts`.
- Root repo remains private and unpublished.
- Package includes a Pi extension, a Pi skill/authoring guide, and a package README.
- MVP preview uses a localhost-only static server from day one.
- **Store base path**: `~/.pi/artifacts/`. The store is the durable, cross-project, cross-session source of truth — not per-session agent runtime state — so it lives in the `~/.pi` ecosystem-data namespace (alongside other tools' data) rather than inside `~/.pi/agent/` next to the disposable `sessions/`. Provenance ties to a session logically via `sessionKey`/`sessionFile` in the manifest, not by physical location. _Revisit if Pi later ships an official extension data-dir convention/API_ (none exists today — the path is chosen manually with `node:os`/`node:path`).
  - **Rebrand-safe derivation**: don't hardcode `.pi`. Pi's config dir name is configurable (`CONFIG_DIR_NAME`, default `.pi`; forks rename it), so compute the store as `join(os.homedir(), CONFIG_DIR_NAME, "artifacts")` — which equals `~/.pi/artifacts/` by default. `CONFIG_DIR_NAME` is exported from `@earendil-works/pi-coding-agent`.
- **Cross-cutting conventions** (dependency placement, no-background-work-in-factory lifecycle anchor, rebrand-safe paths) apply here but are documented once at the repo level — see [`docs/notes/packaging.md` → Extension conventions](../../../docs/notes/packaging.md#extension-conventions-cross-cutting). For this package they mean: validation-gate libs (Prettier, markdownlint, KaTeX; later HTMLHint) go in the package `dependencies`, and the preview server starts in `session_start` / closes in `session_shutdown`.
- **`id` derivation**: `slugify(title)`, with collision handling by numeric suffix (`-2`, `-3`, …). Locked now because the manifest, store, and preview server all encode it.

## MVP

Build the smallest useful package before committing to the full viewer architecture. The MVP is split into two ordered milestones: **MVP-1 proves the entire structural loop with markdown only**, then **MVP-2 layers on the html stack**. This derisks everything structural (store, manifest, tools, gate, server, session provenance) before the heavier shared-runtime-injection work, and matches the "get a usable surface early" principle. The full design is unchanged — this only sequences the build.

### MVP-1 — markdown-only core loop

The smallest end-to-end slice. Markdown is the only `stack`; no shared html runtime yet.

1. Monorepo package scaffold under `packages/`.
2. Pi extension loads from the package.
3. `scaffold_artifact` creates an empty bundle in `<store>/<id>/` (`<store>` = `join(os.homedir(), CONFIG_DIR_NAME, "artifacts")`, i.e. `~/.pi/artifacts/<id>/` by default):
   - `manifest.json`
   - blank `index.md`
   - `assets/`
4. `render_artifact` validates/normalizes the authored bundle and returns warnings/errors.
5. Basic artifact store + manifest metadata:
   - `id`
   - `title`
   - `stack`
   - `entry`
   - `sessionFile` / derived `sessionKey` when available
   - `cwd`
   - timestamps
6. Markdown validation gate: Prettier (autofix) + markdownlint (warn/error) + KaTeX strict (error). **Mermaid parse-check is gated behind the feasibility spike (see Early spikes); ship it warn-only or skipped if it can't run headless in Node.**
7. Simple preview path through a tiny local server from day one:
   - bind to localhost only
   - serve the selected artifact directory
   - serve package runtime files
   - reject path traversal
   - do not proxy external network requests by default
   - **set a baseline restrictive `Content-Security-Policy` header on all responses** (cheap, and it is the real boundary once the html stack lands — establish it now)
8. Markdown authoring skill that tells the agent how to create portable markdown artifacts within the ruleset.
9. Static browser gallery via `/viewer`: list valid store artifacts and link to local previews. Manual refresh is acceptable; live session sync remains deferred.

**Current implementation status:** MVP-1 is implemented with the documented Mermaid fallback: Mermaid fences emit a non-blocking warning instead of syntax validation. The static `/viewer` gallery is also implemented on the localhost server.

### MVP-2 — html stack

Adds the dynamic-UI lane on top of the proven core loop.

1. `scaffold_artifact` supports `type: "html"` → blank `index.html` + `assets/` (same shape as markdown).
2. Shared html runtime injection at render time: semantic CSS base (Pico), Alpine, one charting lib, icons — served by the preview server, never vendored per bundle.
3. html validation gate: Prettier (autofix) + HTMLHint or similar (warn/error) + custom runtime-check (warn).
4. html authoring skill: how semantic HTML maps to the CSS base, dropping an Alpine directive, the chart-spec shape, icon names — the enabler that converts installed capability into low agent effort.
5. Confirm the baseline CSP from MVP-1 holds for runtime-injected JS (Alpine/charts execute in the browser surface).

## Early spikes

Resolve these before investing heavily in the full viewer:

- Viewer runtime: Pi/native webview, general webview binding, or local server + browser + WebSocket/SSE.
- Lifecycle behavior across `/resume`, `/new`, and `/fork`.
- Session identity source: confirm `ctx.sessionManager.getSessionFile()` is sufficient and derive `sessionKey` from it.
- **Mermaid parse-check feasibility in Node**: Mermaid historically needs a DOM (jsdom/puppeteer) even for `mermaid.parse`, unlike KaTeX/markdownlint/Prettier/HTMLHint which run cleanly headless. MVP-1 uses the planned fallback: Mermaid fences produce a warning and never block rendering. Revisit if adding a reliable headless parser.
- HTML rendering security: sandboxing, CSP, network policy, file access, and vendored JS policy. (Baseline CSP is **not** deferred — it ships in MVP-1's preview server; this spike covers the deeper sandboxing posture.)
- Preview server details: port selection, lifecycle/shutdown, stale server cleanup, and path allowlisting.

## Deferred until after MVP

- Fully persistent session-reactive viewer.
- Live session sync.
- Bidirectional viewer-to-agent actions.
- Export flows.
- Live/real-time data feeds.
- Cleanup/retention policy beyond simple manual deletion.
