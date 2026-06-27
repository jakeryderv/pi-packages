# pi-packages

Monorepo of packages for the [Pi coding agent](https://pi.dev/).

## Packages

| Package                                 | npm                        | Status                       |
| --------------------------------------- | -------------------------- | ---------------------------- |
| [`pi-artifacts`](packages/pi-artifacts) | `@jakeryderv/pi-artifacts` | markdown MVP + static viewer |

## Documentation layout

Docs are co-located with their scope. Repo-level material lives at the root;
package-specific material lives inside the package. Within either scope, settled
docs sit in `docs/` and exploratory/thinking notes sit in `docs/notes/`.

- **Repo-level**
  - [Packaging & monorepo reference notes](docs/notes/packaging.md)
- **Package-level** (example: `pi-artifacts`)
  - [Roadmap](packages/pi-artifacts/docs/roadmap.md)
  - [API contract](packages/pi-artifacts/docs/api.md)
  - [Design notes](packages/pi-artifacts/docs/notes/design.md)
  - [Package README](packages/pi-artifacts/README.md) (the only doc that ships to npm)

Conventions for doc placement, dev workflow, and packaging live in
[`AGENTS.md`](AGENTS.md).

## Development

```bash
npm install                                   # install the workspace
npm run typecheck                             # tsc --noEmit across packages
pi -e /abs/path/to/packages/<pkg>             # load a package for one run (test from a temp dir)
```
