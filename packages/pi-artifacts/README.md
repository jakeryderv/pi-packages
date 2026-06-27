# @jakeryderv/pi-artifacts

Rich visualization artifacts for the [Pi coding agent](https://pi.dev/). Scaffold,
validate, and preview artifact bundles — portable markdown documents and an
interactive html stack (Pico CSS + CSP-clean Chart.js) — in a session-scoped
viewer.

> **Status: markdown + html.** The package can scaffold markdown and html
> artifact bundles, validate/normalize them, serve localhost previews, and show
> a static browser gallery via `/viewer`. html artifacts get a shared runtime
> (Pico CSS, Chart.js, icons) injected under a strict CSP. Session-reactive
> gallery updates are still roadmap items. See the [roadmap](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/roadmap.md),
> [API contract](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/api.md),
> and [design notes](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/notes/design.md)
> for the broader plan.

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
  - **markdown:** Prettier + markdownlint + strict KaTeX math; GFM task lists and GitHub-style alerts.
  - **html:** Prettier + HTMLHint + CSP/chart capability checks; shared runtime (Pico CSS, Chart.js via a JSON chart-spec convention, an icon sprite) injected from `/runtime`.
- **`list_artifacts`** tool — list artifact bundles in the store, newest first.
- **`delete_artifact`** tool — delete a bundle and all of its files from the store.
- **`/viewer`** command — open a static gallery of artifacts in the store. When a
  Chromium-family browser is available it opens in a dedicated, chromeless app
  window (isolated profile, closed on session shutdown); otherwise it falls back
  to your default browser. Override with `PI_ARTIFACTS_VIEWER=browser` (force a
  normal tab) or `PI_ARTIFACTS_BROWSER=<path>` (choose the browser binary).
- **`artifacts-authoring`** skill — how to author portable markdown and html artifacts.

Artifacts are stored as content-only bundles under `~/.pi/artifacts/<id>/`
(`manifest.json` + entry file + `assets/`), keyed to their originating session
via provenance metadata in the manifest.

## Security

Pi packages run with full system access. This extension serves artifact previews
only from a localhost-bound server, scoped to the selected artifact directory,
with a restrictive Content-Security-Policy. html artifacts run under the same
strict CSP (`script-src 'self'`): author-supplied inline JS, `on*=` handlers,
and `javascript:` URLs are blocked, and the shared runtime is served only from
the localhost origin. Review the source before installing.

## Development

```bash
# from the monorepo root
npm install
pi -e ./packages/pi-artifacts   # load the package for a single run
```

## License

MIT
