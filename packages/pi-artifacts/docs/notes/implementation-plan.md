# pi-artifacts Implementation Plan

Status: historical implementation record through the original viewer phases.
The markdown/HTML stacks, session-reactive viewer, cleanup, workspace scoping,
declarative HTML components, file-backed feeds, capability-path hardening, and
renderer registry are now implemented. See [`../roadmap.md`](../roadmap.md) and
[`../api.md`](../api.md) for the current status and contract.

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

### Phase D pre-gate — Viewer runtime spike (RESOLVED 2026-06-27)

Time-boxed, read-only investigation completed. **Outcome: confirmed
"server + browser + SSE" as the surface. No bundled webview.** The decision is
settled and Phase D proceeds unambiguously.

**1. Can a Pi extension host a native/embedded webview?**
Not through any first-class API. Reviewed Pi's extension/SDK surface
(`docs/extensions.md`, `tui.md`, `rpc.md`, `windows.md`, the bundled examples):
the only UI affordances an extension gets are terminal-side —
`ctx.ui.notify/select/confirm/input`, footer status, `setWidget`, and full TUI
components via `ctx.ui.custom()` (these render **text lines**, not HTML/web
content). There is no webview/BrowserWindow/iframe host, and zero references to
webview/Electron/Tauri anywhere in Pi's docs. Pi is a terminal harness; it has
no display surface to embed web content into.

**2. Could an extension spawn its own native webview anyway?**
Technically yes, via a third-party napi addon (e.g. `@nativewindow/webview`,
`webviewjs`) that wraps the OS engine (WebKitGTK / WebView2 / WKWebView). But
this violates this package's settled constraints:

- **Native dependency + build/prebuild toolchain** — breaks the
  "ship `.ts`, jiti loads it, no build step" rule and the
  `npm install --omit=dev` runtime-deps model. Prebuilt binaries per
  platform/arch are a maintenance and trust burden.
- **Lifecycle cost** — the addon window would need explicit create/destroy
  wired into `session_start`/`session_shutdown`/`/resume`/`/fork`, duplicating
  what the launcher already does for the browser app-window, but with native
  crash/leak risk instead of a detached child process.

**3. SSH / headless / container portability — the decisive factor.**
Native webviews are graphical and **require an active display**; over SSH or in
headless containers they fail without a virtual framebuffer (Xvfb) or a remote
display-streaming shim. That directly breaks the terminal-agent workflow a Pi
package must support. The current model — bind `localhost`, open a browser (or
just print the URL) — degrades gracefully: on a remote box you port-forward
`localhost:<port>` and view locally; no display assumed. This is the
server-first posture's whole point, and it is the reason a webview stays off.

**Conclusion.** Everything Phase D needs — session-scoped lists, live updates,
later bidirectional actions — is reachable with the existing localhost server
plus **Server-Sent Events** (`text/event-stream`, an `EventSource` in the page
shell, a set of held-open responses broadcast to on render/session change). SSE
is a few lines of stdlib `http`, no new dependency, CSP-compatible under
`connect-src 'self'` (already in `BASELINE_CSP`), and unidirectional
server→viewer which is exactly the push direction D needs. A webview remains a
possible _optional_ front-end later where a local display exists, reusing the
same transport seam (invariant 2) — never a replacement that breaks remote use.

**Implications for building D:** add an SSE endpoint behind the transport seam;
keep the renderer/store unaware of it (invariants 1 & 3). `connect-src 'self'`
is already present, so no CSP change. The open Phase A `/resume` smoke test
(no leaked servers) should be confirmed first, since D pushes over the
session-lifecycle boundary it exercises.

### Phase D — Session-reactive viewer (DONE, 0.3.0)

Built on the resolved spike (server + browser + SSE). Shipped:

1. **Session-scoped gallery.** `/viewer` filters by the active `sessionKey`
   (already in the manifest); `/viewer?all` shows every session, and the header
   carries a toggle between the two. With no active session key the viewer shows
   all (unchanged behavior).
2. **Live push via SSE.** The preview server exposes `/events`
   (`text/event-stream`); pages open an `EventSource` and reload on `update`.
   `broadcastUpdate(id?)` fires on `render_artifact`, `delete_artifact`, and
   `session_start`/replacement. The shared client (`/runtime/pi/viewer-live.js`,
   a served file — inline `<script>` is CSP-blocked) is included by **both** the
   gallery and every artifact page: the gallery reloads on any update; an
   artifact page (tagged with `data-artifact-id`) reloads only when its own id
   is broadcast, so editing+re-rendering one artifact refreshes that open page
   without disturbing unrelated tabs. A full authored html document (served
   verbatim) opts out of live reload. Allowed by `connect-src 'self'` (no CSP
   change); no new dependency (stdlib `http`).
3. **Transport seam preserved (invariants 1–3).** Push lives entirely in the
   server's SSE client set + `broadcastUpdate()`; the renderer and store are
   unaware of it. The extension calls `setSessionKey`/`broadcastUpdate` through
   the `PreviewServerState` interface only. A webview front-end could reuse the
   same seam later.
4. **Lifecycle safety.** `close()` ends every held-open SSE response before
   `server.close()`, so session replacement still tears the server down cleanly
   — verified by the live `/resume` smoke test (no leaked servers) and a
   teardown test asserting `close()` completes < 1s with open SSE clients.

Tests: 29 total (was 26) — session filtering, `?all` override, unscoped
fallback, SSE stream + broadcast + clean teardown. Full preflight clean.
Version bumped to 0.3.0; publish left as a manual step.

**Viewer-mode setting (0.4.0).** Follow-up UX: a persisted preference for how
`/viewer` opens, so users aren't re-exporting an env var each session. New
`extensions/viewer-config.ts` reads/writes `{ viewerMode }` to
`~/.pi/artifacts/config.json` (rebrand-safe; never throws on missing/corrupt).
New `/viewer-mode app|browser|off` command sets it; bare invocation reports the
current value. Launch precedence is `PI_ARTIFACTS_VIEWER` env > saved setting >
default `app`; `openViewerWindow` gained a `none` short-circuit (print URL only,
useful for SSH/headless). App mode stays the default — this only makes the
choice discoverable and sticky.

**Render auto-open (0.4.0).** Default-on: a successful `render_artifact`
auto-shows the artifact. If a viewer window is already open, the server pushes
an SSE `navigate` event (new `broadcastNavigate`) and the window switches to the
freshly rendered artifact — no new window, no flicker on the edit→render loop;
otherwise it launches one pointed at the artifact. Honors the saved viewer mode
(`none`/off launches nothing, so SSH/headless stays quiet). Toggle with a new
`/viewer-auto on|off` command; `autoOpen` persists in the same config file
(merge-on-write so it coexists with `viewerMode`, defaults to `true`). The
live-reload client gained a `navigate` handler (switches via `location.assign`
only when not already on the target). Tests: 33 total (auto-open default/
round-trip, `navigate` SSE event). Version remains 0.4.0 (bundled before
publish).

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
