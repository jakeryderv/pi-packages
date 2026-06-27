import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import type { ViewerWindowMode } from "./viewer-launcher.ts";

/**
 * Persisted viewer preferences (Phase C/D UX). Lets a user set how `/viewer`
 * behaves once and have it stick across sessions, instead of re-exporting an
 * env var each time. Stored as a tiny JSON file alongside the artifact store
 * (rebrand-safe path), separate from the artifacts themselves.
 *
 *   { "viewerMode": "app" | "browser" | "none", "autoOpen": boolean }
 *
 * - `viewerMode` — how the viewer opens. Launch precedence:
 *   env override > this saved setting > built-in default (`app`).
 * - `autoOpen` — whether a successful render auto-shows the artifact
 *   (reusing an open window). Defaults to `true` when unset.
 */
export type ViewerModePreference = ViewerWindowMode;

export interface ViewerConfig {
  viewerMode?: ViewerModePreference;
  autoOpen?: boolean;
}

const VALID_MODES: readonly ViewerModePreference[] = ["app", "browser", "none"];

export function viewerConfigPath(): string {
  return join(homedir(), CONFIG_DIR_NAME, "artifacts", "config.json");
}

export function isViewerMode(value: unknown): value is ViewerModePreference {
  return (
    typeof value === "string" &&
    VALID_MODES.includes(value as ViewerModePreference)
  );
}

/** Read the whole config, or `{}` when missing/corrupt. Never throws. */
async function readConfig(path: string): Promise<ViewerConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as ViewerConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Merge a patch into the config, creating the store directory if needed. */
async function writeConfig(patch: ViewerConfig, path: string): Promise<void> {
  const next = { ...(await readConfig(path)), ...patch };
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

/** Saved viewer mode, or `undefined` when unset/invalid. */
export async function readViewerMode(
  path = viewerConfigPath(),
): Promise<ViewerModePreference | undefined> {
  const { viewerMode } = await readConfig(path);
  return isViewerMode(viewerMode) ? viewerMode : undefined;
}

export async function writeViewerMode(
  mode: ViewerModePreference,
  path = viewerConfigPath(),
): Promise<void> {
  await writeConfig({ viewerMode: mode }, path);
}

/** Whether render auto-open is enabled. Defaults to `true` when unset. */
export async function readAutoOpen(
  path = viewerConfigPath(),
): Promise<boolean> {
  const { autoOpen } = await readConfig(path);
  return typeof autoOpen === "boolean" ? autoOpen : true;
}

export async function writeAutoOpen(
  enabled: boolean,
  path = viewerConfigPath(),
): Promise<void> {
  await writeConfig({ autoOpen: enabled }, path);
}
