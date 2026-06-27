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

## Current security posture

- Artifact previews bind only to localhost.
- Artifact files and runtime files are served from separate namespaces:
  `/artifacts/<id>/...` and `/runtime/<namespace>/...`.
- Path traversal is rejected in store APIs and server file serving.
- HTML artifacts are declarative content, not mini web apps:
  - inline executable `<script>` warns,
  - authored `<script src>` warns,
  - inline event handlers warn,
  - `javascript:` URLs warn,
  - artifact `.js` files are rejected by the server.
- Runtime JavaScript is package-owned and served only from `/runtime`.
- Manifest `lastRender` metadata stores the latest render status so list/viewer
  surfaces can show OK/warning/error/never-rendered state.

## Parked / future work

- **Export flows:** produce portable outputs, likely starting with single-file
  HTML export for html artifacts and rendered HTML/PDF for markdown artifacts.
- **Retention/cleanup policy:** the global store grows until manual deletion.
  Future options include age-based cleanup, project/session filters, or a bulk
  clear command.
- **Richer curated runtime components:** add reusable declarative patterns only
  when repeated artifact authoring needs justify them.
- **Mermaid validation feasibility:** revisit if a reliable headless parser is
  available without heavy DOM/browser dependencies.
- **Live data:** snapshot data works today via `assets/`; true live data remains
  a future viewer-brokered capability.
- **Bidirectional viewer-to-agent actions:** intentionally deferred.
- **Advanced script-enabled stack:** not planned by default. If ever needed,
  make it explicit rather than weakening the default html stack.
