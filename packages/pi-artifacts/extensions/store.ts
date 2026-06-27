import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import { createManifest, isArtifactManifest } from "./manifest.ts";
import { isPathInside } from "./path-safety.ts";
import { slugifyTitle, suffixSlug } from "./slug.ts";
import type {
  ArtifactManifest,
  ArtifactStack,
  ScaffoldArtifactDetails,
} from "./types.ts";

/**
 * Root of the durable, cross-project artifact store.
 *
 * Derived from `CONFIG_DIR_NAME` rather than a hardcoded `.pi` so it stays
 * correct under rebranded Pi distributions. Defaults to `~/.pi/artifacts/`.
 */
export function artifactsRoot(): string {
  return join(homedir(), CONFIG_DIR_NAME, "artifacts");
}

export function artifactPath(id: string, root = artifactsRoot()): string {
  return join(root, id);
}

export function manifestPath(id: string, root = artifactsRoot()): string {
  return join(artifactPath(id, root), "manifest.json");
}

export function entryFileNameForStack(stack: ArtifactStack): string {
  switch (stack) {
    case "markdown":
      return "index.md";
    case "html":
      return "index.html";
  }
}

export function entryPath(
  id: string,
  stack: ArtifactStack,
  root = artifactsRoot(),
): string {
  return join(artifactPath(id, root), entryFileNameForStack(stack));
}

export interface ScaffoldArtifactInput {
  title: string;
  stack: ArtifactStack;
  cwd: string;
  root?: string;
  now?: Date;
  sessionFile?: string;
  sessionKey?: string;
}

export async function scaffoldArtifact(
  input: ScaffoldArtifactInput,
): Promise<ScaffoldArtifactDetails> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Artifact title must not be empty.");
  }

  const root = input.root ?? artifactsRoot();
  const baseSlug = slugifyTitle(title);
  await mkdir(root, { recursive: true });

  const id = await reserveArtifactId(root, baseSlug);
  const path = artifactPath(id, root);
  const entryName = entryFileNameForStack(input.stack);
  const entry = join(path, entryName);
  const assetsPath = join(path, "assets");
  const manifest = createManifest({
    id,
    title,
    stack: input.stack,
    entry: entryName,
    cwd: input.cwd,
    now: input.now,
    sessionFile: input.sessionFile,
    sessionKey: input.sessionKey,
  });

  await mkdir(assetsPath, { recursive: true });
  await writeFile(entry, "", { flag: "wx" });
  await writeFile(
    manifestPath(id, root),
    `${JSON.stringify(manifest, null, 2)}\n`,
    {
      flag: "wx",
    },
  );

  return {
    id,
    path,
    entry,
    manifestPath: manifestPath(id, root),
  };
}

async function reserveArtifactId(
  root: string,
  baseSlug: string,
): Promise<string> {
  for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const id = suffixSlug(baseSlug, index);
    try {
      await mkdir(artifactPath(id, root));
      return id;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Unable to allocate artifact id for ${baseSlug}.`);
}

export interface LoadedArtifact {
  id: string;
  path: string;
  manifestPath: string;
  manifest: ArtifactManifest;
  entryPath: string;
}

export async function loadArtifact(
  id: string,
  root = artifactsRoot(),
): Promise<LoadedArtifact> {
  const path = artifactPath(id, root);
  const mPath = manifestPath(id, root);
  const rawManifest = await readFile(mPath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Artifact "${id}" does not exist.`);
    }
    throw error;
  });

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(rawManifest);
  } catch (error) {
    throw new Error(`Artifact "${id}" has invalid manifest JSON.`);
  }

  if (!isArtifactManifest(parsedManifest)) {
    throw new Error(`Artifact "${id}" has an invalid manifest shape.`);
  }

  if (parsedManifest.id !== id) {
    throw new Error(
      `Artifact "${id}" manifest id mismatch: ${parsedManifest.id}.`,
    );
  }

  const resolvedEntryPath = resolve(path, parsedManifest.entry);
  if (!isPathInside(path, resolvedEntryPath)) {
    throw new Error(`Artifact "${id}" entry path escapes its bundle.`);
  }

  const entryStats = await stat(resolvedEntryPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Artifact "${id}" entry file is missing.`);
    }
    throw error;
  });

  if (!entryStats.isFile()) {
    throw new Error(`Artifact "${id}" entry is not a file.`);
  }

  return {
    id,
    path,
    manifestPath: mPath,
    manifest: parsedManifest,
    entryPath: resolvedEntryPath,
  };
}

export async function listArtifacts(
  root = artifactsRoot(),
): Promise<LoadedArtifact[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    },
  );

  const artifacts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) =>
        loadArtifact(entry.name, root).catch(() => undefined),
      ),
  );

  return artifacts
    .filter((artifact): artifact is LoadedArtifact => artifact !== undefined)
    .sort((left, right) =>
      right.manifest.updated.localeCompare(left.manifest.updated),
    );
}

export async function writeManifest(
  id: string,
  manifest: ArtifactManifest,
  root = artifactsRoot(),
): Promise<void> {
  await writeFile(
    manifestPath(id, root),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

export async function deleteArtifact(
  id: string,
  root = artifactsRoot(),
): Promise<void> {
  const path = artifactPath(id, root);
  if (!isPathInside(root, path) || path === resolve(root)) {
    throw new Error(`Invalid artifact id: ${id}`);
  }

  const stats = await stat(path).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Artifact "${id}" does not exist.`);
    }
    throw error;
  });

  if (!stats.isDirectory()) {
    throw new Error(`Artifact "${id}" is not a bundle directory.`);
  }

  await rm(path, { recursive: true, force: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
