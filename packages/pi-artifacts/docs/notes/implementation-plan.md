# pi-artifacts Implementation Plan

Status: MVP-1 (markdown loop) and the static viewer are complete and preflighted.
This document now tracks the forward roadmap after that milestone.

## Completed — MVP-1 + static viewer

- `scaffold_artifact` creates durable, collision-safe markdown bundles
  (`manifest.json` + blank `index.md` + `assets/`) under
  `join(homedir(), CONFIG_DIR_NAME, "artifacts")`.
- `render_artifact` loads/validates a bundle, formats markdown (Prettier),
  lints (markdownlint, warn), checks math (KaTeX strict, error), warns on
  non-portable syntax, warns `mermaid/not-validated`, updates the manifest,
  and returns a localhost preview URL.
- Localhost-only preview server: per-artifact rendered HTML, in-bundle assets,
  KaTeX runtime from `/runtime`, baseline CSP, traversal rejection.
- Renderer handles tables, inline/display math, GFM task lists (checkboxes),
  GitHub-style alerts (`> [!NOTE]` …), and embedded SVG/images.
- `/viewer` static browser gallery lists valid store artifacts.
- Tests cover slug/manifest/store/validation/server/renderer; preflight clean.

Deferred by choice: Mermaid diagram rendering and headless Mermaid validation
(revisit when it makes sense; see roadmap Early spikes).

## Forward plan (ordered)

Recommended order: A → B (optional) → C → D → E → F.
Settled decision: build the html lane (C) before session-reactive sync (D) so the
reactive viewer is built once against both artifact types.

## Rendering-surface posture (settled for now)

**Server + default browser is the chosen surface; a bundled webview is held off.**
A webview is mostly a UX/integration upgrade (embedded, always-there, Pi-managed
window + cleaner click-back IPC), not a capability unlock — live updates,
session-reactive lists, and bidirectional actions are all reachable with
server + browser + SSE. A webview also trades away the no-native-dep simplicity
and, critically, the SSH/remote/headless portability that suits a terminal agent
(port-forward `localhost` vs. assuming a local display). Posture: **server-first,
webview as an optional additional front-end later where a display exists** — never
a replacement that breaks remote workflows.

### Decoupling invariants (respect these in every phase, especially C)

These keep the browser↔webview choice cheap to defer and prevent rewrites:

1. All rendering stays HTTP-served HTML + assets; no browser-only assumptions in
   the renderer or store.
2. Keep "how the artifact list/updates reach the surface" behind a thin transport
   seam, so SSE ↔ webview-IPC is swappable without touching renderer/store.
3. Keep bidirectional/viewer→agent actions out of the renderer; route them
   through the transport seam only.

### Phase A — Agent ergonomics + hardening (mostly done)

Low risk, high daily value. Contained to existing modules.

1. `list_artifacts` tool — DONE (exposes id, title, stack, updated, cwd).
2. `delete_artifact` tool — DONE (removes bundle, rejects traversal ids,
   unregisters from the preview server).
3. `/viewer` auto-open — DONE. Opens a dedicated chromeless app window via a
   Chromium-family browser (`--app` + isolated `--user-data-dir`), Pi-managed and
   closed on session shutdown; falls back to default browser, then to a printed
   URL. Overrides: `PI_ARTIFACTS_VIEWER=browser`, `PI_ARTIFACTS_BROWSER=<path>`.
   Recovers the "own GUI" feel without a native dependency; respects the
   server-first posture (it is only a launcher in front of the same server).
4. Lifecycle across `/resume`, `/new`, `/fork` — correct by construction
   (`session_shutdown` closes the server, `session_start` recreates it on a fresh
   port, extensions rebind with a new accessor). Still wants a manual live
   `/resume` smoke test to confirm no leaked servers.
5. Robustness: empty store and bad bundles are skipped by `listArtifacts`; the
   gallery reads from disk so deletes/edits reflect immediately. DONE.

### Phase B — First real publish (milestone, optional timing)

Cut `0.1.0` so `pi update` propagates and it is installable as a catalog package.
Run full preflight + `npm pack --dry-run` content check first.

### Phase C — MVP-2: html stack

1. `scaffold_artifact` accepts `type: "html"` → blank `index.html` + `assets/`.
2. Shared html runtime injected at render time (semantic CSS base, Alpine,
   one charting lib, icons), served from `/runtime`, never vendored per bundle.
3. html validation gate (Prettier + HTMLHint or similar + runtime-capability check).
4. html authoring skill.
5. Make the deliberate CSP decision for runtime-injected JS.

Constraint: respect the decoupling invariants above so the eventual reactive
surface (browser SSE vs. webview) stays a late, cheap decision.

### Phase D pre-gate — Viewer runtime spike (research only)

Time-boxed, read-only investigation before building D. The answer can collapse
the decision entirely:

- Can a Pi extension host a native/embedded webview at all? (Pi is a TUI harness
  — this is genuinely uncertain.)
- Is there a viable Pi-native or general binding, and what is its install,
  cross-platform, and `/resume` `/new` `/fork` lifecycle cost?
- Does it work in SSH/headless/container sessions, or only with a local display?

Outcome: confirm "server + browser + SSE" (current trajectory) or surface a
credible optional webview front-end. If no clean webview option exists for Pi
extensions, the decision is settled as server + browser and D proceeds
unambiguously. Runnable anytime — even alongside Phase C.

### Phase D — Session-reactive viewer

1. Filter the gallery by active `sessionKey`.
2. Push updates to the open viewer on `session_start`/replacement and on render
   (SSE/WebSocket). Depends on Phase A lifecycle work and the runtime spike.
3. Keep the push mechanism behind the transport seam (invariant 2) so a webview
   front-end could reuse it later.

### Phase E — Export

Single-file export: inlined HTML first, then PDF / md.

### Phase F — Retention/cleanup

`/artifacts clear` or age-based eviction using manifest timestamps.

## Preflight (run from repo root)

```bash
npm run typecheck
npm test
npm run format:check
npm run lint:md
npm run pack:artifacts -- --json
```

Manual smoke test:

```bash
cd "$(mktemp -d)"
pi -e /home/jake/dev/projects/pi-packages/packages/pi-artifacts
```
