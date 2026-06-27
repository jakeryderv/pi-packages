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

Input: `{}`.

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
  "count": 1
}
```

Artifacts are listed newest-first by `updated`. Invalid/unreadable bundles are
skipped rather than failing the call.

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

## Commands

### `/viewer`

Opens the live artifact gallery served by the localhost preview server. The
gallery is scoped to the active Pi session by default and can switch to all
sessions. Gallery pages and open artifact pages subscribe to Server-Sent Events
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
- Mermaid fenced blocks return a non-blocking `mermaid/not-validated` warning.

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
- chart hydration, live reload, and icons (`/runtime/pi/...`)

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

## Mermaid validation

Mermaid parsing is warn-only until headless Node parsing is proven simple and
reliable. It must not block rendering by default.
