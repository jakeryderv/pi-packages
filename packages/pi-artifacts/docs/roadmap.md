# Visualization Artifacts Roadmap

This is the implementation roadmap for `@jakeryderv/pi-artifacts`. The pinned
contract lives in [`./api.md`](./api.md), and historical product/design notes
live in `docs/notes/design.md`. Cross-cutting repo conventions
(dependency placement, extension lifecycle, rebrand-safe paths) live in the
repo-level [`packaging notes`](../../../docs/notes/packaging.md).

## Settled foundations

- Workspace package folder: `packages/pi-artifacts`.
- Published npm package: `@jakeryderv/pi-artifacts`.
- Root repo remains private and unpublished.
- Package includes a Pi extension, a Pi skill/authoring guide, and a package
  README.
- Preview uses a localhost-only static server from day one.
- **Store base path**: `join(os.homedir(), CONFIG_DIR_NAME, "artifacts")`,
  which is `~/.pi/artifacts/` by default but stays rebrand-safe.
- The store is durable and cross-project; provenance ties artifacts to sessions
  via `sessionFile`/`sessionKey` in the manifest.
- The preview server starts in `session_start` or lazily on first render and
  closes in `session_shutdown`; no server starts in the extension factory.
- **`id` derivation**: `slugify(title)`, with collision handling by numeric
  suffix (`-2`, `-3`, ...).

## Completed milestones

### MVP-1 — markdown core loop

Implemented:

1. Monorepo package scaffold under `packages/`.
2. Pi extension loads from the package.
3. `scaffold_artifact` creates markdown bundles:
   - `manifest.json`
   - blank `index.md`
   - `assets/`
4. `render_artifact` validates/normalizes the authored bundle and returns
   warnings/errors.
5. Artifact store + manifest metadata:
   - `id`
   - `title`
   - `stack`
   - `entry`
   - `sessionFile` / `sessionKey` when available
   - `cwd`
   - timestamps
6. Markdown validation gate:
   - Prettier autofix
   - markdownlint warnings
   - KaTeX strict render-blocking errors
   - Mermaid fences as non-blocking `mermaid/not-validated` warnings
7. Localhost preview server:
   - binds to `127.0.0.1`
   - serves artifact files and package runtime files
   - rejects path traversal
   - sets a baseline restrictive `Content-Security-Policy`
8. Markdown authoring skill.

### MVP-2 — html stack

Implemented, with a deliberate no-framework/no-authored-JS design instead of the
original Alpine direction:

1. `scaffold_artifact` supports `type: "html"` → blank `index.html` +
   `assets/`.
2. Shared html runtime is injected at render time and served from `/runtime`:
   - Pico CSS classless semantic base
   - Chart.js UMD bundle
   - CSP-clean chart hydration from JSON chart specs
   - icon sprite
3. html validation gate:
   - Prettier autofix
   - HTMLHint warnings
   - CSP/capability warnings for authored JavaScript and missing chart specs
4. html authoring skill documents semantic HTML, CSS-only interactivity, chart
   specs, and icons.
5. Strict CSP remains in place (`script-src 'self'`), while artifact bundle
   JavaScript is rejected so only package-owned runtime scripts execute.

### Live viewer

Implemented:

- `/viewer` opens a session-scoped artifact gallery.
- Gallery can toggle to all sessions.
- Gallery supports search plus stack/status filters.
- Gallery and artifact pages have a persistent toolbar for navigation and
  future actions such as export.
- Gallery and artifact pages subscribe to Server-Sent Events.
- Render/delete/session-scope changes live-reload relevant pages.
- `/viewer-mode app|browser|off` persists launch behavior.
- `/viewer-auto on|off` controls render auto-open/navigation.
- Dedicated Chromium-family app window mode uses an isolated profile and closes
  on session shutdown.

### Mermaid rendering

Implemented via the shared runtime (same pattern as Chart.js):

- Markdown ` ```mermaid ` fences render to `<pre class="mermaid">`; the
  html stack authors the same element directly.
- The mermaid bundle + a package-owned init script are served from `/runtime`
  under the strict CSP, and injected only into pages that contain a diagram.
- Theme follows `prefers-color-scheme`; parse errors render inline in place of
  the diagram.
- The old `mermaid/not-validated` warning is gone — diagrams render instead.

### 0.6.0 — richer authoring and store hygiene

Implemented alongside mermaid:

- Footnotes render via `markdown-it-footnote` (previously promised by the
  authoring skill but rendered as literal `[^1]` text).
- Fenced code with a language tag is syntax-highlighted server-side
  (highlight.js common grammars); GitHub light/dark theme CSS is served from
  `/runtime/hljs` and injected only when a page has highlighted code.
- `delete_artifacts` tool (bulk delete by ids and/or `older_than_days`) and
  `/artifacts-clean <days>` command.
- `writeManifest` is atomic (write temp + rename) so crashes/concurrent
  sessions cannot leave truncated manifests.

### 0.7.0 — workspace scoping

- Viewer gallery scope is three-way: this session / this workspace / all
  artifacts (`?scope=session|workspace|all`; `?all` kept as an alias).
- "This workspace" matches the artifact manifest `cwd` exactly against the
  active session's cwd.
- `list_artifacts` accepts the same optional `scope` parameter.
- Scope filtering is shared (`extensions/scope.ts`) and degrades to "all"
  when the anchor (session key / cwd) is unknown.

### 0.8.0 — declarative components and viewer hardening

- HTML fragments gain package-owned Web Components for responsive grids,
  cards, metrics, Chart.js charts, and tables while retaining the
  no-authored-JavaScript policy.
- `<pi-data-source>` loads one-shot JSON snapshots from the current artifact's
  `assets/` directory; `data-feed` and dotted `field` paths bind components to
  that data. Remote, root-relative, encoded, traversal, and cross-artifact feed
  sources are rejected.
- A typed renderer registry now owns stack entry filenames, validation, and
  page rendering for markdown and HTML.
- Preview servers start lazily and protect viewer pages, SSE, artifacts, and
  assets with a random per-server capability path. Package-owned `/runtime`
  files remain on their stable content-free namespace.
- Chromium app mode now observes process liveness, waits for launch success,
  and performs bounded shutdown/profile cleanup.

### 0.8.1 — correctness and store hardening

- Markdown math is parsed only from Markdown text tokens, so inline/fenced code
  and ambiguous currency text remain literal.
- Store APIs reject nested paths and other values outside the generated artifact
  ID format.
- Concurrent manifest updates use unique same-directory temporary files before
  atomic rename.
- `markdown-it` requires the patched 14.3 release line.

### 0.9.0 — portable single-file export

- `export_artifact` writes a deterministic standalone HTML file for markdown or
  html bundles under the artifact's `exports/` directory.
- Gallery rows and shared-shell artifact toolbars provide direct generated
  downloads without persisting another file.
- Package runtime styles/scripts, KaTeX fonts, icons, referenced artifact assets,
  and JSON component feeds are embedded.
- A standalone CSP disables network access, grants a random nonce only to
  package-owned runtime scripts, and authored executable hooks are removed.

## Current security posture

- Artifact previews start lazily, bind only to localhost, and require an
  unguessable per-server capability path for content-bearing routes.
- Artifact files and runtime files are served from separate namespaces:
  `/artifacts/<id>/...` and `/runtime/<namespace>/...`.
- Path traversal is rejected in store APIs and server file serving.
- HTML artifacts are declarative content, not mini web apps:
  - inline executable `<script>` warns,
  - authored `<script src>` warns,
  - inline event handlers warn,
  - `javascript:` URLs warn,
  - artifact `.js` files are rejected by the server.
- Runtime JavaScript is package-owned and served only from `/runtime`; that
  stable public namespace contains no artifact data.
- File-backed component feeds are confined to the current bundle's `assets/`
  directory and render data-derived text with DOM `textContent`.
- Manifest `lastRender` metadata stores the latest render status so list/viewer
  surfaces can show OK/warning/error/never-rendered state.

## Parked / future work

- **Additional export formats:** single-file HTML shipped in 0.9.0; PDF and ZIP
  bundle export remain future options.
- **Retention/cleanup policy:** age-based and bulk deletion shipped in 0.6.0
  (`delete_artifacts`, `/artifacts-clean`). Automatic/background retention and
  project/session-scoped filters remain future options.
- **Richer curated runtime components:** add reusable declarative patterns only
  when repeated artifact authoring needs justify them.
- **Mermaid server-side validation:** diagrams now render client-side with
  inline error display; a render-gate syntax check is still deferred until a
  reliable headless parser exists without heavy DOM/browser dependencies.
- **Live data:** snapshot data works today via `assets/`; true live data remains
  a future viewer-brokered capability.
- **Bidirectional viewer-to-agent actions:** intentionally deferred.
- **Advanced script-enabled stack:** not planned by default. If ever needed,
  make it explicit rather than weakening the default html stack.
