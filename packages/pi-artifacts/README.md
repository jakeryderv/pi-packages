# @jakeryderv/pi-artifacts

Rich visualization artifacts for the [Pi coding agent](https://pi.dev/). Scaffold,
validate, and preview artifact bundles — portable markdown documents today, an
interactive html stack next — in a session-scoped viewer.

> **Status: markdown MVP.** The package can scaffold markdown artifact bundles,
> validate/normalize them, serve localhost previews, and show a static browser
> gallery via `/viewer`. The html stack and session-reactive gallery updates are
> still roadmap items. See the [roadmap](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/roadmap.md),
> [API contract](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/api.md),
> and [design notes](https://github.com/jakeryderv/pi-packages/blob/main/packages/pi-artifacts/docs/notes/design.md)
> for the broader plan.

## What it provides

- **`scaffold_artifact`** tool — create an empty markdown artifact bundle to author into.
- **`render_artifact`** tool — validate/normalize an authored markdown bundle and preview it on localhost.
- **`list_artifacts`** tool — list artifact bundles in the store, newest first.
- **`delete_artifact`** tool — delete a bundle and all of its files from the store.
- **`/viewer`** command — open a static gallery of artifacts in the store. When a
  Chromium-family browser is available it opens in a dedicated, chromeless app
  window (isolated profile, closed on session shutdown); otherwise it falls back
  to your default browser. Override with `PI_ARTIFACTS_VIEWER=browser` (force a
  normal tab) or `PI_ARTIFACTS_BROWSER=<path>` (choose the browser binary).
- **`artifacts-authoring`** skill — how to author portable markdown artifacts.

Artifacts are stored as content-only bundles under `~/.pi/artifacts/<id>/`
(`manifest.json` + entry file + `assets/`), keyed to their originating session
via provenance metadata in the manifest.

## Security

Pi packages run with full system access. This extension serves artifact previews
only from a localhost-bound server, scoped to the selected artifact directory,
with a restrictive Content-Security-Policy. Review the source before installing.

## Development

```bash
# from the monorepo root
npm install
pi -e ./packages/pi-artifacts   # load the package for a single run
```

## License

MIT
