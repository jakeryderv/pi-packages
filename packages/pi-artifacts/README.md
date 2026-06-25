# @jakeryderv/pi-artifacts

Rich visualization artifacts for the [Pi coding agent](https://pi.dev/). Scaffold,
validate, and preview artifact bundles — portable markdown documents today, an
interactive html stack next — in a session-scoped viewer.

> **Status: scaffold.** The package loads and registers its tools/command as
> stubs. See the [roadmap](docs/roadmap.md) for the sequenced build (MVP-1
> markdown-only, then MVP-2 html) and the [design notes](docs/notes/design.md)
> for the full vision.

## What it provides

- **`scaffold_artifact`** tool — create an empty artifact bundle to author into.
- **`render_artifact`** tool — validate/normalize an authored bundle and preview it.
- **`/viewer`** command — open the artifacts viewer for the current session.
- **`artifacts-authoring`** skill — how to author portable artifacts.

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
