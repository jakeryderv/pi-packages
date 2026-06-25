import type { ArtifactManifest, ArtifactStack } from "./types.ts";

const SUPPORTED_STACKS = new Set<ArtifactStack>(["markdown"]);

export interface CreateManifestInput {
  id: string;
  title: string;
  stack: ArtifactStack;
  entry: string;
  cwd: string;
  now?: Date;
  sessionFile?: string;
  sessionKey?: string;
}

export function createManifest(input: CreateManifestInput): ArtifactManifest {
  const timestamp = (input.now ?? new Date()).toISOString();

  return {
    id: input.id,
    title: input.title,
    stack: input.stack,
    entry: input.entry,
    created: timestamp,
    updated: timestamp,
    cwd: input.cwd,
    ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
  };
}

export function isSupportedStack(value: string): value is ArtifactStack {
  return SUPPORTED_STACKS.has(value as ArtifactStack);
}

export function isArtifactManifest(value: unknown): value is ArtifactManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.stack === "string" &&
    isSupportedStack(candidate.stack) &&
    typeof candidate.entry === "string" &&
    typeof candidate.created === "string" &&
    typeof candidate.updated === "string" &&
    typeof candidate.cwd === "string" &&
    (candidate.sessionFile === undefined ||
      typeof candidate.sessionFile === "string") &&
    (candidate.sessionKey === undefined ||
      typeof candidate.sessionKey === "string")
  );
}
