# Visualization Artifacts Roadmap

This is the implementation roadmap for the first package in this repo: `@jakeryderv/pi-artifacts`. The fuller product/design notes live in [`../notes/pi-visualization-artifacts.md`](../notes/pi-visualization-artifacts.md).

## Initial scaffold decisions

- Workspace package folder: `packages/pi-artifacts`.
- Published npm package: `@jakeryderv/pi-artifacts`.
- Root repo remains private and unpublished.
- Package includes a Pi extension, a Pi skill/authoring guide, and a package README.
- MVP preview uses a localhost-only static server from day one.

## MVP

Build the smallest useful package before committing to the full viewer architecture:

1. Monorepo package scaffold under `packages/`.
2. Pi extension loads from the package.
3. `scaffold_artifact` creates an empty bundle in `~/.pi/artifacts/<id>/`:
   - `manifest.json`
   - blank `index.md` or `index.html`
   - `assets/`
4. `render_artifact` validates/normalizes the authored bundle and returns warnings/errors.
5. Basic artifact store + manifest metadata:
   - `id`
   - `title`
   - `stack`
   - `entry`
   - `sessionFile` / derived `sessionKey` when available
   - `cwd`
   - timestamps
6. Basic markdown/html handling.
7. Simple preview path through a tiny local server from day one:
   - bind to localhost only
   - serve the selected artifact directory
   - serve package runtime files
   - reject path traversal
   - do not proxy external network requests by default
8. Authoring skill that tells the agent how to create artifacts with the supported runtime.

## Early spikes

Resolve these before investing heavily in the full viewer:

- Viewer runtime: Pi/native webview, general webview binding, or local server + browser + WebSocket/SSE.
- Lifecycle behavior across `/resume`, `/new`, and `/fork`.
- Session identity source: confirm `ctx.sessionManager.getSessionFile()` is sufficient and derive `sessionKey` from it.
- HTML rendering security: sandboxing, CSP, network policy, file access, and vendored JS policy.
- Preview server details: port selection, lifecycle/shutdown, stale server cleanup, and path allowlisting.

## Deferred until after MVP

- Fully persistent session-reactive viewer.
- Live session sync.
- Bidirectional viewer-to-agent actions.
- Export flows.
- Live/real-time data feeds.
- Cleanup/retention policy beyond simple manual deletion.
