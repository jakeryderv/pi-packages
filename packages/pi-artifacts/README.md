# @jakeryderv/pi-artifacts

Rich visualization artifacts for the [Pi coding agent](https://pi.dev/). Scaffold,
validate, and preview artifact bundles — portable markdown documents and an
interactive html stack (declarative components, Pico CSS, and CSP-clean
Chart.js) — in a session-scoped viewer.

> **Status: markdown + declarative html, live viewer.** The package can scaffold markdown
> and html artifact bundles, validate/normalize them, serve localhost previews,
> and show a session-scoped browser gallery via `/viewer` that updates live
> (Server-Sent Events) as artifacts are rendered or deleted — and open artifact
> pages reload themselves when re-rendered. html artifacts get a shared runtime
> (Pico CSS, components, file-backed feeds, Chart.js, Mermaid, icons) injected
> under a strict CSP. See
> the [roadmap](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/roadmap.md),
> [API contract](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/api.md),
> and [design notes](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/notes/design.md)
> for the broader plan.

## What's new in 0.8.0

- **Declarative HTML components**: package-owned `<pi-grid>`, `<pi-card>`,
  `<pi-metric>`, `<pi-chart>`, and `<pi-table>` Web Components provide a
  consistent dashboard vocabulary without authored JavaScript or a build step.
- **Artifact-local data feeds**: `<pi-data-source>` loads one-shot JSON snapshots
  from the bundle's `assets/` directory and binds them to metrics, charts, and
  tables with `data-feed` and optional dotted `field` paths.
- **Viewer hardening**: artifact content, gallery pages, and SSE now use a random
  per-server capability path; the preview server starts lazily and adds no-store
  and same-origin resource headers.
- **Cleaner internals and launcher lifecycle**: renderer selection is centralized
  in a typed registry, while app mode tracks Chromium liveness, launch failure,
  and profile cleanup more reliably.

## What was new in 0.7.0

- **Workspace scoping**: the viewer gallery now has a three-way scope —
  this session / this workspace (artifacts created from the same cwd) / all
  artifacts — and `list_artifacts` accepts an optional
  `scope: "session" | "workspace" | "all"` parameter.

## What was new in 0.6.0

- **Mermaid diagrams render live** in both stacks: markdown ` ```mermaid `
  fences and html `<pre class="mermaid">` blocks hydrate client-side under the
  strict CSP (theme follows light/dark; syntax errors show inline). The old
  `mermaid/not-validated` warning is gone.
- **Syntax highlighting** for fenced code blocks with a language tag
  (highlighted server-side via highlight.js; GitHub light/dark themes).
- **Footnotes** (`[^1]`) now render as a linked footnotes section.
- **Store cleanup**: new `delete_artifacts` bulk tool (by ids and/or age) and
  `/artifacts-clean <days>` command.
- Manifest writes are atomic (write-then-rename), hardening the shared store
  against crashes and concurrent sessions.

## Install

```bash
pi install npm:@jakeryderv/pi-artifacts
```

To try it for a single run without adding it to your Pi settings:

```bash
pi -e npm:@jakeryderv/pi-artifacts
```

## Quickstart

After installing or loading the package, ask Pi to create and render an artifact:

```text
Create a markdown artifact titled "Demo Report" with a heading, a short note callout, a task list, and a small table. Then render it.
```

Or an html dashboard with a chart:

```text
Create an html artifact titled "Q4 Dashboard" with a summary section and a bar chart of quarterly revenue. Then render it.
```

Pi will scaffold a bundle, write the entry file, validate it, and return
a localhost preview URL. Run `/viewer` to open the artifact gallery, then use
`list_artifacts` or `delete_artifact` when you want to inspect or clean up saved
bundles.

## What it provides

- **`scaffold_artifact`** tool — create an empty markdown or html artifact bundle to author into.
- **`render_artifact`** tool — validate/normalize an authored bundle and preview it on localhost.
  - **markdown:** Prettier + markdownlint + strict KaTeX math; GFM task lists, GitHub-style alerts, footnotes, syntax-highlighted code, and Mermaid fences rendered as live diagrams.
  - **html:** Prettier + HTMLHint + CSP/component capability checks; shared runtime (Pico CSS, declarative Web Components, artifact-local JSON feeds, Chart.js, Mermaid, and icons) injected from `/runtime`.
- **`list_artifacts`** tool — list artifact bundles in the store, newest first;
  optionally scoped to the current session or workspace (cwd).
- **`delete_artifact`** tool — delete a bundle and all of its files from the store.
- **`delete_artifacts`** tool — bulk-delete bundles by id list and/or age.
- **`/artifacts-clean`** command — delete artifacts not updated in N days
  (`/artifacts-clean 30`); with no argument, shows the store size.
- **`/viewer`** command — open a live gallery of artifacts with a three-way
  scope (this session / this workspace / all artifacts), search/filter
  controls, render status badges, and auto-updating via Server-Sent Events as
  you render or delete. Gallery and artifact pages include a persistent toolbar with
  navigation/actions, ready for future export controls. When a Chromium-family
  browser is available it opens in a dedicated, chromeless app
  window (isolated profile, closed on session shutdown); otherwise it falls back
  to your default browser.
- **`/viewer-mode`** command — set how `/viewer` opens and remember it across
  sessions: `app` (dedicated window, default), `browser` (your default browser),
  or `off` (just print the URL — handy over SSH/headless). Run with no argument
  to see the current setting. One-off overrides: `PI_ARTIFACTS_VIEWER=app|browser|none`
  (env wins over the saved setting) and `PI_ARTIFACTS_BROWSER=<path>` (choose the
  app-mode browser binary).
- **`/viewer-auto`** command — toggle whether a successful render auto-shows the
  artifact: `on` (default) or `off`. When on, rendering opens the viewer if it
  isn't already; if a window is already open it switches to the freshly rendered
  artifact (no new window). Honors `/viewer-mode off` (stays quiet on
  SSH/headless). Run with no argument to see the current setting.
- **`artifacts-authoring`** skill — how to author portable markdown and html artifacts.

Artifacts are stored as content-only bundles under `~/.pi/artifacts/<id>/`
(`manifest.json` + entry file + `assets/`), keyed to their originating session
via provenance metadata in the manifest.

## Security

Pi packages run with full system access. This extension serves artifact previews
only from a localhost-bound server, scoped to the selected artifact directory,
with an unguessable per-server capability path and restrictive
Content-Security-Policy. html artifacts run under the same
strict CSP (`script-src 'self'`), but the package keeps artifacts content-only:
author-supplied inline JS, authored `<script src>` files, `on*=` handlers, and
`javascript:` URLs are blocked or rejected, and executable runtime JS is served
only from the package-owned `/runtime` namespace. Viewer, SSE, artifact pages,
and artifact assets require the random capability path; `/runtime` intentionally
remains a stable public path because it contains only immutable package-owned
assets, never artifact content. Review the source before installing.

## Development

```bash
# from the monorepo root
npm install
pi -e ./packages/pi-artifacts   # load the package for a single run
```

## License

MIT
