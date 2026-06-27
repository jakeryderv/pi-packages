# pi-artifacts Implementation Plan

Status: MVP-1 (markdown loop) + static viewer are complete, preflighted, and
**published as `@jakeryderv/pi-artifacts@0.1.0`** (npm, public; git tag
`pi-artifacts-v0.1.0`). This document tracks the forward roadmap.

**Next task: Phase D — session-reactive viewer (and/or the Phase D pre-gate
webview spike, runnable anytime).** Phase C (the html stack, Passes 1 and 2) is
complete and preflighted; `0.2.0` is staged in `package.json` and awaiting an
`npm publish`.

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

Recommended order: A (done) → B (done, 0.1.0) → C (next) → D → E → F.
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

### Phase B — First real publish (DONE)

Published `@jakeryderv/pi-artifacts@0.1.0` to npm (public). Release polish landed
in the same pass: package metadata (`repository`/`bugs`/`homepage`, expanded
`keywords`, `author`), README Install/Quickstart, bundled `LICENSE` (added to
`files`), root README status updated. Git tag `pi-artifacts-v0.1.0` pushed.
Future publishes: scope-level granular npm token on `@jakeryderv` (read/write,
bypass 2FA) covers every package in this monorepo.

### Phase C — MVP-2: html stack

Do this in two passes. **Pass 1 is the next task**: prove `stack: "html"` plugs
into the existing store/server/tools end-to-end with a trivial renderer — before
any shared runtime, validation gate, or CSP-for-JS decisions. Defer the heavier
work (Pass 2 below) until the slice is green.

#### Pass 1 — minimal html vertical slice (DONE)

Goal: scaffold → author `index.html` → render → preview → list/delete, all
working for html, with the smallest possible html render path. No Alpine, no
charts, no icons, no injected JS yet.

Shipped: `ArtifactStack` is `"markdown" | "html"`; `manifest.ts` accepts
`"html"`; `entryFileNameForStack` returns `index.html` for html;
`scaffold_artifact`'s `type` is a `markdown | html` union. New
`extensions/html.ts` (`renderHtmlPage` — wraps an authored fragment in the
shared page shell, serves a full document verbatim) and
`extensions/validation/html.ts` (`validateHtmlArtifact` — reads the entry, no
findings yet). `render_artifact`/`sendRenderedArtifact` route on
`manifest.stack`. html previews flow through the unchanged localhost server
under the existing `BASELINE_CSP` (`script-src 'self'` already blocks inline JS,
so the CSP-for-JS decision stays deferred to Pass 2). Tests: 6 added
(render-shell/verbatim, scaffold, validate, preview-with-CSP, delete); markdown
suite still green; full preflight clean. Landed on `main`, unreleased.

Original Pass 1 checklist (all done):

1. Allow `"html"` as a `stack`/`type`. Touch `extensions/types.ts` (stack union)
   and `extensions/manifest.ts` (`isArtifactManifest` accepts `"html"`,
   `entry` may be `index.html`). Keep `"markdown"` behavior identical.
2. `scaffold_artifact({ type: "html", title })` → bundle with `manifest.json`
   (`stack: "html"`, `entry: "index.html"`) + blank `index.html` + `assets/`.
   Reuse the existing scaffold/collision/store logic; only the entry filename
   and stack differ. (See `extensions/store.ts`, `extensions/slug.ts`.)
3. Add a minimal html render path. Mirror `extensions/markdown.ts` /
   `extensions/validation/markdown.ts` with an html equivalent that, for now,
   just wraps/serves the authored `index.html` body in the page shell (same
   `<head>`/CSP wrapper the markdown renderer uses). `render_artifact` routes on
   `manifest.stack`: `"markdown"` → existing path, `"html"` → new path.
4. Serve html previews through the existing localhost server unchanged — same
   localhost bind, per-artifact scope, traversal rejection, baseline CSP. No new
   server surface. (See `extensions/server.ts`.)
5. Tests: scaffold/render/list/delete for html bundles, plus the existing
   markdown tests still pass. Keep the markdown↔html branch logic covered.

Respect the decoupling invariants above: the html path stays HTTP-served HTML +
assets, with no browser-only assumptions, so the browser↔webview choice stays
cheap to defer.

#### Pass 2 — shared runtime + gate + skill (DONE)

**CSP decision (settled):** keep the strict baseline (`script-src 'self'`, no
`unsafe-eval`) and adopt a **no-framework** posture instead of Alpine. Reasoning:
Alpine is the worst of the tradeoff here — its standard build needs `unsafe-eval`
(weakening the very sandbox that makes running agent-authored html safe), and its
CSP-safe build is a restricted dialect the model authors unreliably. Plain
HTML/CSS is the most-trained, most-predictable target for a one-shot generator,
and the `/runtime` seam stays open to add a tiny vanilla-JS helper later if a
real interactivity need appears. This collapsed the CSP gate to "keep strict."

**Charting (settled): Chart.js**, configured via a CSP-clean JSON-spec
convention (`<canvas data-chart>` + sibling
`<script type="application/json" class="pi-chart-spec">`; a single served
hydration script reads the spec and renders). JSON is data, not code, so it is
allowed under the strict CSP, and emitting a JSON spec plays to the agent's
strengths. Chosen over Vega-Lite (heavier, grammar authored less reliably) and
over deferring charts (loses hover/tooltip/resize and forces hand-computed
scales).

Shipped:

1. Shared html runtime served from a **namespaced `/runtime/<ns>/` registry**
   (`extensions/runtime.ts`): `pico` (Pico classless CSS), `chartjs` (Chart.js
   UMD), `pi` (this package's `chart-hydrate.js` + `icons.svg`), and the
   existing `katex`. Resolved via `require.resolve`, never vendored per bundle.
   `renderHtmlPage` injects Pico + Chart.js + the hydration script into the
   page shell. A full authored document is served verbatim (opts out).
2. html validation gate (`extensions/validation/html.ts`): Prettier (autofix) +
   HTMLHint (warn) + CSP capability checks (`csp/inline-script`,
   `csp/inline-handler`, `csp/javascript-url`) + `chart/missing-spec`. All
   advisory; html is served regardless. HTMLHint added to `dependencies`.
3. html authoring skill: `skills/artifacts-authoring/SKILL.md` HTML stack
   section rewritten (Pico mapping, strict-CSP rules, CSS-only interactivity,
   the Chart.js JSON-spec shape, icon ids).
4. CSP decision settled as above (no JS framework; strict baseline holds).
5. Version bumped to `0.2.0` (description/keywords updated). **Publish is
   intentionally left to a manual `npm publish` step.**

Tests: 26 total (was 23) — runtime injection in the shell, namespaced runtime
serving + traversal guard, Prettier autofix, CSP warnings, chart-spec
presence/absence. Full preflight clean; `npm pack --dry-run` ships the runtime
assets and nothing else.

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
