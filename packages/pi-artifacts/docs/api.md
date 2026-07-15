# pi-artifacts API Contract

This document pins the current tool, command, manifest, validation, and preview
server contracts for `@jakeryderv/pi-artifacts`. Fields may be added later, but
existing fields should remain stable.

## `scaffold_artifact`

Input:

```json
{
  "type": "markdown",
  "title": "Artifact title"
}
```

`type` accepts:

- `"markdown"` — creates `index.md`.
- `"html"` — creates `index.html`.

Structured result (`details`):

```json
{
  "id": "artifact-title",
  "path": "/home/me/.pi/artifacts/artifact-title",
  "entry": "/home/me/.pi/artifacts/artifact-title/index.md",
  "manifestPath": "/home/me/.pi/artifacts/artifact-title/manifest.json"
}
```

Paths are absolute so the agent can immediately edit the entry file with normal
file tools.

ID and overwrite policy:

- `id` is derived with `slugify(title)`.
- Existing bundles are never overwritten by scaffolding.
- Collisions append numeric suffixes: `artifact-title`, `artifact-title-2`,
  `artifact-title-3`, and so on.

## `render_artifact`

Input:

```json
{
  "id": "artifact-title"
}
```

Structured result (`details`):

```json
{
  "ok": true,
  "warnings": [],
  "errors": [],
  "url": "http://127.0.0.1:45123/artifacts/artifact-title/"
}
```

- `ok`: whether rendering is allowed.
- `warnings`: non-blocking validation findings.
- `errors`: render-blocking validation findings.
- `url`: present when a preview is available.

Tool `content` should contain a concise human summary. Tool `details` is the
source of truth for structured follow-up.

## `list_artifacts`

Input (all optional):

```json
{
  "scope": "workspace"
}
```

`scope` accepts `"session"` (artifacts created by the current session),
`"workspace"` (artifacts whose manifest `cwd` equals the current session's
cwd, exact match), or `"all"` (default).

Structured result (`details`):

```json
{
  "artifacts": [
    {
      "id": "artifact-title",
      "title": "Artifact title",
      "stack": "markdown",
      "updated": "2026-06-24T00:00:00.000Z",
      "cwd": "/home/me/project"
    }
  ],
  "count": 1,
  "scope": "workspace"
}
```

Artifacts are listed newest-first by `updated`. Invalid/unreadable bundles are
skipped rather than failing the call. A scope whose anchor is unknown (no
session key or cwd available) degrades to `"all"` rather than returning
nothing.

## `delete_artifact`

Input:

```json
{
  "id": "artifact-title"
}
```

Structured result (`details`):

```json
{
  "ok": true,
  "id": "artifact-title"
}
```

- Deletes the entire bundle directory and unregisters any active preview.
- Rejects ids that escape the store (path traversal) and ids that do not exist;
  failures return `{ ok: false, id, error }`.

## `delete_artifacts`

Input (at least one field required):

```json
{
  "ids": ["artifact-title", "other-artifact"],
  "older_than_days": 30
}
```

Structured result (`details`):

```json
{
  "ok": true,
  "deleted": ["artifact-title"],
  "count": 1
}
```

- `ids` are deleted directly; missing or invalid ids are skipped, not errors.
- `older_than_days` additionally deletes every artifact whose manifest
  `updated` timestamp is older than that many days.
- `deleted` lists the ids actually removed. Calling with neither field returns
  `{ ok: false, deleted: [], count: 0 }` without deleting anything.

## Commands

### `/viewer`

Opens the live artifact gallery served by the localhost preview server. The
gallery is scoped to the active Pi session by default and can switch scope via
`?scope=session|workspace|all` (a three-way switcher in the toolbar):
`workspace` shows artifacts whose manifest `cwd` exactly matches the active
session's cwd; `?all` is kept as a legacy alias for `?scope=all`. Gallery
pages and open artifact pages subscribe to Server-Sent Events
and live-reload on render/delete/session-scope changes. The gallery supports
server-side search plus stack/status filters (`markdown`/`html`, OK, warnings,
errors, never rendered). Gallery and artifact pages include a persistent toolbar
for navigation and stable future actions such as export.

When a Chromium-family browser is available, `/viewer` launches a dedicated,
chromeless app window with an isolated profile, managed by the extension and
closed on session shutdown. Otherwise it falls back to the default browser, then
to printing the URL.

Environment overrides:

- `PI_ARTIFACTS_VIEWER=app|browser|none`
- `PI_ARTIFACTS_BROWSER=<path>`

### `/viewer-mode`

Persists how `/viewer` opens:

- `app` — dedicated Chromium-family app window when available.
- `browser` — default browser.
- `off` — print the URL only (`none` internally), useful for SSH/headless.

Run with no argument to see the current setting.

### `/viewer-auto`

Toggles whether a successful render auto-shows the artifact. When enabled, an
already-open viewer window navigates to the freshly rendered artifact via SSE;
otherwise a viewer window is opened according to `/viewer-mode`. Run with no
argument to see the current setting.

### `/artifacts-clean`

Age-based bulk deletion: `/artifacts-clean 30` deletes every artifact not
updated in the last 30 days (all sessions). Run with no argument to see the
store size without deleting anything.

## Manifest

Each bundle contains `manifest.json`:

```json
{
  "id": "artifact-title",
  "title": "Artifact title",
  "stack": "markdown",
  "entry": "index.md",
  "created": "2026-06-24T00:00:00.000Z",
  "updated": "2026-06-24T00:00:00.000Z",
  "cwd": "/home/me/project",
  "sessionFile": "/home/me/.pi/agent/sessions/session.jsonl",
  "sessionKey": "sha256-session-file-path",
  "lastRender": {
    "ok": true,
    "warnings": 1,
    "errors": 0,
    "rendered": "2026-06-24T00:05:00.000Z",
    "warningCodes": ["markdownlint"]
  }
}
```

Required fields: `id`, `title`, `stack`, `entry`, `created`, `updated`, `cwd`.
Optional fields: `sessionFile`, `sessionKey`, `lastRender`.

Timestamp policy:

- Use ISO-8601 strings from `Date.prototype.toISOString()`.
- `created` is fixed at scaffold time.
- `updated` changes when the bundle is rendered.
- `lastRender` records the latest render attempt status, including failed
  validation attempts that did not produce a preview.

## Validation severity

Render-blocking errors are reserved for content that will not render.
Formatting, style, portability, and best-practice findings are warnings unless
they directly prevent rendering.

Markdown validation:

- Prettier formats `index.md` in place.
- markdownlint findings are warnings.
- KaTeX math parse failures are render-blocking errors.
- Mermaid fenced blocks produce no validation findings; they render
  client-side via the shared runtime, and invalid syntax shows an inline error
  in the rendered page.

HTML validation:

- Prettier formats `index.html` in place.
- HTMLHint findings are warnings.
- Capability/security checks warn on authored executable JavaScript and missing
  chart specs.
- HTML warnings are advisory; the preview server's CSP and file-serving policy
  enforce the runtime boundary.

## HTML runtime and JavaScript policy

HTML artifacts are content-only, declarative bundles. The package injects and
serves the curated runtime from `/runtime`:

- Pico CSS (`/runtime/pico/...`)
- Chart.js (`/runtime/chartjs/...`)
- Mermaid (`/runtime/mermaid/...`)
- highlight.js theme CSS (`/runtime/hljs/...`; markdown code is highlighted
  server-side, so no highlighting JavaScript is served)
- chart hydration, mermaid init, live reload, and icons (`/runtime/pi/...`)

Author-provided JavaScript is not allowed. The validation gate warns on:

- inline executable `<script>` bodies,
- authored `<script src="...">`,
- inline event handlers such as `onclick=`,
- `javascript:` URLs.

Artifact `.js` files under `/artifacts/<id>/...` are rejected by the preview
server. Runtime JavaScript remains available only under `/runtime/...`.

Charting is declarative: author a `<canvas data-chart>` plus a sibling
`<script type="application/json" class="pi-chart-spec">` JSON Chart.js config.
JSON script blocks are data, not authored executable JavaScript.

## Preview server baseline

Preview serving must:

- bind only to localhost (`127.0.0.1`),
- serve only artifact bundle files and package runtime files,
- reject path traversal,
- reject executable JavaScript from artifact bundles,
- avoid proxying external network requests by default,
- set a restrictive Content-Security-Policy header on every response.

## Mermaid rendering

Mermaid diagrams render client-side: markdown ` ```mermaid ` fences (and
authored `<pre class="mermaid">` blocks in the html stack) become
`<pre class="mermaid">` elements, hydrated by the package-owned runtime served
from `/runtime` under the strict CSP. The mermaid bundle is injected only into
pages that contain a diagram. Server-side syntax validation stays out of the
gate (a headless Node parser remains unproven); parse errors surface inline in
the rendered page and must not block rendering.
