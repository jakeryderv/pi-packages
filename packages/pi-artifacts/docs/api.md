# pi-artifacts API Contract

This document pins the MVP-1 tool and manifest shapes before implementation.
The extension may add fields later, but existing fields should remain stable.

## `scaffold_artifact`

Input:

```json
{
  "type": "markdown",
  "title": "Artifact title"
}
```

MVP-1 accepts only `"markdown"`. Later milestones add `"html"`.

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

## `/viewer` command

Opens the static artifact gallery served by the localhost preview server. When a
Chromium-family browser is available it launches a dedicated, chromeless app
window with an isolated profile, managed by the extension and closed on session
shutdown. Otherwise it falls back to the default browser, then to printing the
URL. Overrides: `PI_ARTIFACTS_VIEWER=browser`, `PI_ARTIFACTS_BROWSER=<path>`.

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
  "sessionKey": "sha256-session-file-path"
}
```

Required fields: `id`, `title`, `stack`, `entry`, `created`, `updated`, `cwd`.
Optional fields: `sessionFile`, `sessionKey`.

Timestamp policy:

- Use ISO-8601 strings from `Date.prototype.toISOString()`.
- `created` is fixed at scaffold time.
- `updated` changes when the bundle is mutated by scaffold/render operations.

## Validation severity

Render-blocking errors are reserved for content that will not render. Formatting,
style, portability, and best-practice findings are warnings unless they directly
prevent rendering.

## Preview server baseline

MVP-1 preview serving must:

- bind only to localhost (`127.0.0.1` or equivalent),
- serve only the selected artifact directory and package runtime files,
- reject path traversal,
- avoid proxying external network requests by default,
- set a restrictive Content-Security-Policy header on every response.

## Mermaid validation

Mermaid parsing is warn-only or skipped until headless Node parsing is proven
simple and reliable. It must not block MVP-1 rendering by default.
