import type { LoadedArtifact } from "./store.ts";

export type ArtifactScope = "session" | "workspace" | "all";

/** The active session's identity, used to anchor scope filtering. */
export interface ScopeContext {
  sessionKey?: string;
  cwd?: string;
}

export function isArtifactScope(value: string): value is ArtifactScope {
  return value === "session" || value === "workspace" || value === "all";
}

/**
 * Scope filtering shared by the viewer and the list tool. `session` matches
 * the artifact's provenance session key; `workspace` matches the exact cwd
 * the artifact was scaffolded from. A scope whose anchor is unknown (no
 * active session key / cwd yet) degrades to "all" rather than hiding
 * everything.
 */
export function filterByScope(
  artifacts: LoadedArtifact[],
  scope: ArtifactScope,
  context: ScopeContext,
): LoadedArtifact[] {
  if (scope === "session" && context.sessionKey) {
    return artifacts.filter(
      (artifact) => artifact.manifest.sessionKey === context.sessionKey,
    );
  }
  if (scope === "workspace" && context.cwd) {
    return artifacts.filter(
      (artifact) => artifact.manifest.cwd === context.cwd,
    );
  }
  return artifacts;
}
