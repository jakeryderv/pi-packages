import { homedir } from "node:os";
import { join } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import type { ArtifactStack } from "./types";

/**
 * Root of the durable, cross-project artifact store.
 *
 * Derived from `CONFIG_DIR_NAME` rather than a hardcoded `.pi` so it stays
 * correct under rebranded Pi distributions. Defaults to `~/.pi/artifacts/`.
 */
export function artifactsRoot(): string {
  return join(homedir(), CONFIG_DIR_NAME, "artifacts");
}

export function artifactPath(id: string): string {
  return join(artifactsRoot(), id);
}

export function manifestPath(id: string): string {
  return join(artifactPath(id), "manifest.json");
}

export function entryFileNameForStack(stack: ArtifactStack): string {
  switch (stack) {
    case "markdown":
      return "index.md";
  }
}

export function entryPath(id: string, stack: ArtifactStack): string {
  return join(artifactPath(id), entryFileNameForStack(stack));
}
