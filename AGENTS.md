# pi-packages — Repo Guide

Monorepo of independently-published packages for the Pi coding agent. The repo
root is **private and never published**; each package under `packages/*`
publishes to npm independently under `@jakeryderv/pi-*` with its own catalog entry.

## Documentation placement

- **Co-locate docs with their scope.** Repo-level material → root `docs/`.
  Package-specific material → `packages/<pkg>/docs/`.
- **Within any scope:** settled docs in `docs/`, exploratory/thinking notes in
  `docs/notes/`.
- **Only the package `README.md` ships to npm** (it's in `files`). Internal
  `docs/` stay git-tracked but out of the tarball.
- Do **not** put package-specific design/roadmap docs in the root `docs/`.

## Package conventions

- npm workspaces. Root `package.json` is `private`. Each package: `keywords:
  ["pi-package"]`, a `pi` manifest, and a tight `files` list (resource dirs +
  README only).
- **Peer deps** `"*"` for Pi core imports (`@earendil-works/pi-*`) and `typebox`;
  declare only what is actually imported. Pi provides them at runtime.
- **Runtime deps go in `dependencies`** — package installs run
  `npm install --omit=dev`, so `devDependencies` are absent at runtime.
  Repo-hygiene-only linters/formatters may live in the workspace-root
  `devDependencies`.
- **Extensions:** no background work (sockets/servers/watchers/timers) in the
  factory function. Start session-scoped resources in `session_start` (or lazily
  on first use); tear them down in an idempotent `session_shutdown`.
- **Rebrand-safe paths:** derive `~/.pi/...` as
  `join(os.homedir(), CONFIG_DIR_NAME, ...)`, never a hardcoded `.pi`.
  `CONFIG_DIR_NAME` is exported from `@earendil-works/pi-coding-agent`.
- **No build step:** ship `.ts` source (jiti loads it). `tsconfig` is
  typecheck-only (`noEmit`).

Full reasoning: [`docs/notes/packaging.md`](docs/notes/packaging.md).

## Dev & test workflow

- **Iterate** by loading a package for one run from a scratch temp dir:
  `cd "$(mktemp -d)" && pi -e /abs/path/to/packages/<pkg>`. This is ephemeral
  (writes nothing persistent, no trust prompt) and loads your full global
  environment plus the package. No hot reload on `-e` — restart, or symlink the
  package into `~/.pi/agent/extensions/` for `/reload`.
- **Never add in-repo packages (`./packages/*`) to `.pi/settings.json`.** That
  file is for external catalog packages only. In-repo packages are tested via
  `-e`, not installed into the repo.
- **Before publishing:** `npm run typecheck`, then `npm pack --dry-run` inside
  the package to confirm the tarball contains only resource dirs + README (no
  `docs/`, no `node_modules/`).

## Publishing

- Scoped packages publish with public access. Start at `0.0.0`; cut real semver
  bumps so `pi update` propagates changes to installs.

## Project `.pi/`

- `./.pi/settings.json` holds **external catalog packages** scoped to this repo.
  Review third-party source before adding — Pi packages run with full system
  access. Currently empty; lead candidate: **pi-committer** (conventional-commit
  - changelog automation, opt-in per project).
- Running pi in this repo prompts to `/trust` it once (to load `.pi/` resources).
  `defaultProjectTrust` is a global setting and does not belong in this file.
