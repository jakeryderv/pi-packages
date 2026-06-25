# Pi Packages — Monorepo Reference Notes

Conceptual outline for building and publishing packages for the Pi coding agent. No code/commands — just the model to reason from.

## The catalog & discovery

- `pi.dev/packages` is an **index of npm packages**, not a separate registry.
- A package appears there by being **published to npm** with the **`pi-package` keyword**. That keyword is the only gate.
- Git-installed packages work fine for personal/team use but **won't show in the catalog** (the gallery scans npm only).
- One npm package = one catalog entry. The catalog indexes per-package, not per-repo.

## What a Pi package is

- Just a normal **npm package** with a **`pi` manifest** added (a `pi` key in `package.json`) pointing at resource directories.
- Bundles any mix of four resource types: **extensions** (TypeScript that adds tools/commands/events/UI), **skills** (on-demand markdown instructions), **prompt templates** (markdown that becomes slash commands), **themes** (color JSON).
- If no manifest is present, Pi **auto-discovers** from conventional directories named for each resource type.
- **No build step** — Pi loads TypeScript directly (via jiti), so packages ship source, not compiled output.

## Dependency model

- **Pi core packages** → declared as **peer dependencies** (wildcard range), never bundled. Pi provides them at runtime.
- **Third-party runtime deps** → normal dependencies. Pi installs them automatically on package install.
- **Runtime deps must be in `dependencies`, never `devDependencies`.** Package installs run `npm install --omit=dev`, so `devDependencies` are not present at runtime. Anything an extension imports when it runs (validation/format/lint libs, runtime libs) belongs in `dependencies`. The same formatters/linters used only to lint this repo's own sources can stay in the workspace-root `devDependencies` — a separate concern.
- **Depending on another Pi package** is the exception → must be bundled (`dependencies` + `bundledDependencies`), not peered.
- The "files" list controls what actually ships in the npm tarball: resource dirs + README only (internal `docs/` stay out of the tarball).

## Monorepo strategy (the chosen approach)

- One repo, multiple publishable packages under a `packages/` workspace. The **repo root is private** and never published; each package publishes independently.
- Each package is its **own npm package** → its **own catalog entry** → independently installable and versioned.
- Why this over alternatives:
  - **vs. one giant package**: users can install just the piece they want; each is independently discoverable. Use a single package only when the pieces are meaningless apart (e.g. an extension plus the skill that drives it).
  - **vs. many separate repos**: shared tooling, one place to track everything, one CI/release setup — without losing the per-package catalog entries.
- Keep core Pi packages in the **workspace-root dev dependencies** too, so local development resolves the same imports the published packages get at runtime.

### Repo setup defaults

- Use **npm workspaces** unless there is a specific reason to choose another package manager; Pi installs npm/git packages with `npm install`, so npm workspaces keep local development closest to installed behavior.
- Keep the root `package.json` private and place publishable packages under `packages/*`.
- Put package-specific runtime dependencies in each package's `dependencies`; put shared dev tooling and Pi core type packages in the workspace root `devDependencies`.
- Give every publishable package a tight `files` list from the start: resource directories (`extensions`, `skills`, `prompts`, `themes`) plus README/docs/assets needed at runtime/catalog time.
- Add `pi.image` or `pi.video` later when there is a meaningful preview for the catalog.

### Extension conventions (cross-cutting)

Conventions that apply to every extension-bearing package in this repo, verified against the Pi docs:

- **No background work in the extension factory.** Pi may run the factory in invocations that never start a session, so do not start sockets/servers/file-watchers/timers there. Start session-scoped resources in `session_start` (or lazily on first use) and tear them down in an **idempotent `session_shutdown`** handler.
- **Rebrand-safe paths.** Pi's config dir name is configurable (`CONFIG_DIR_NAME`, default `.pi`; forks rename it). Derive any `~/.pi/...` path as `join(os.homedir(), CONFIG_DIR_NAME, ...)` instead of hardcoding `.pi`. `CONFIG_DIR_NAME` is exported from `@earendil-works/pi-coding-agent`.
- **Peer imports.** Importing any Pi core package (`@earendil-works/pi-coding-agent`, `pi-ai`, `pi-agent-core`, `pi-tui`) or `typebox` → declare it in `peerDependencies` with `"*"`. Pi provides these at runtime; declare only the ones actually imported.

### Naming

- **Repo**: `pi-packages` on GitHub (private root, never published; name just mirrors `pi.dev/packages`).
- **Packages**: scoped under the GitHub/npm username → `@jakeryderv/pi-*`.
- **First package**: `@jakeryderv/pi-artifacts`.
- The npm identity is what appears in install commands and catalog entries — the repo name is just a human label.

## Lifecycle

- **Develop**: run Pi with the working copy loaded live; edit and re-run. Optionally install locally into a real project to test the installed shape.
- **Publish**: bump version, publish each package to npm independently (scoped packages need public access, especially on first publish).
- **Update (user side)**: Pi compares installed vs latest npm version and pulls latest on update. Pinned-version installs are never auto-updated — so cut real semver bumps for changes to propagate.
- **Release automation**: a conventional-commits → auto-changelog → version-bump → auto-publish flow works well per-package in a monorepo. Worth setting up once the package count grows.

## Sources of truth & caveats

- **Build against the official docs/examples** for correctness: the Pi docs site, the packages spec doc, and the maintainers' extension examples folder. The *conventions* there are authoritative.
- The popular **`pi-package-template`** is **community-published (by s1m0n38), not official**. It's a convenient scaffold, not a blessed reference — and its CI/release scaffolding is the genuinely reusable part. Review third-party source before relying on it.
- **Package scope naming — two distinct scopes, don't conflate them**:
  - **Your publish scope** stays **`@jakeryderv/pi-*`**. This is the npm identity that appears in install commands and catalog entries. It is unaffected by anything Pi does with its own scope.
  - **Pi's core import scope** is **`@earendil-works/*`** — relevant *only* as the `peerDependencies` import names you declare (e.g. `@earendil-works/pi-coding-agent`). The note that "the project moved to `@earendil-works/*`" refers to **Pi's** packages, not yours. Match this scope only for the peer-dep imports the installed Pi CLI exposes; older material may reference the previous names.

## Security framing

- Pi packages run with **full system access** — extensions execute arbitrary code, and skills can instruct the model to run anything. There's no built-in permission sandbox.
- Users are told to review source before installing, so a clean public repo, clear README, and honest description help adoption.
