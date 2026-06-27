import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, sep } from "node:path";
import { env, platform } from "node:process";

export type ViewerWindowMode = "app" | "browser" | "none";

export interface ViewerWindow {
  mode: ViewerWindowMode;
  close: () => Promise<void>;
}

/**
 * Chromium-family browsers support a chromeless "app mode" window
 * (`--app=<url>`). Combined with an isolated `--user-data-dir`, this gives the
 * artifact viewer its own clean, minimal GUI window instead of a tab in the
 * user's default browser — without any native dependency or build step.
 *
 * Falls back to the default browser, then to nothing, when no Chromium-family
 * browser is available.
 *
 * Mode precedence: `PI_ARTIFACTS_VIEWER` env override > the `preferred`
 * argument (a persisted user setting) > the built-in default (`app`). The
 * binary used for app mode can be overridden with `PI_ARTIFACTS_BROWSER`.
 */
export async function openViewerWindow(
  url: string,
  preferred?: ViewerWindowMode,
): Promise<ViewerWindow> {
  const mode = resolveViewerMode(preferred);

  if (mode === "none") {
    return { mode: "none", close: async () => {} };
  }

  if (mode === "browser") {
    return openDefaultBrowser(url);
  }

  const browser = await resolveBrowser();
  if (browser) {
    const appWindow = await launchAppWindow(browser, url);
    if (appWindow) {
      return appWindow;
    }
  }

  return openDefaultBrowser(url);
}

function resolveViewerMode(preferred?: ViewerWindowMode): ViewerWindowMode {
  const fromEnv = env.PI_ARTIFACTS_VIEWER;
  if (fromEnv === "browser" || fromEnv === "app" || fromEnv === "none") {
    return fromEnv;
  }
  return preferred ?? "app";
}

export function buildAppWindowArgs(url: string, profileDir: string): string[] {
  return [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
  ];
}

const CHROMIUM_CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    join(
      env.PROGRAMFILES ?? "C:\\Program Files",
      "Google\\Chrome\\Application\\chrome.exe",
    ),
    join(
      env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
      "Google\\Chrome\\Application\\chrome.exe",
    ),
    join(
      env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
      "Microsoft\\Edge\\Application\\msedge.exe",
    ),
  ],
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
  ],
};

async function resolveBrowser(): Promise<string | undefined> {
  const override = env.PI_ARTIFACTS_BROWSER;
  if (override) {
    return (await resolveCandidate(override)) ?? undefined;
  }

  const candidates = CHROMIUM_CANDIDATES[platform] ?? CHROMIUM_CANDIDATES.linux;
  for (const candidate of candidates ?? []) {
    const resolved = await resolveCandidate(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

async function resolveCandidate(
  candidate: string,
): Promise<string | undefined> {
  if (
    isAbsolute(candidate) ||
    candidate.includes(sep) ||
    candidate.includes("/")
  ) {
    return (await isExecutable(candidate)) ? candidate : undefined;
  }

  const dirs = (env.PATH ?? "").split(delimiter);
  for (const dir of dirs) {
    if (!dir) {
      continue;
    }
    const full = join(dir, candidate);
    if (await isExecutable(full)) {
      return full;
    }
  }

  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function launchAppWindow(
  browser: string,
  url: string,
): Promise<ViewerWindow | undefined> {
  let profileDir: string | undefined;

  try {
    profileDir = await mkdtemp(join(tmpdir(), "pi-artifacts-viewer-"));
    const child = spawn(browser, buildAppWindowArgs(url, profileDir), {
      stdio: "ignore",
      detached: false,
    });

    let exited = false;
    child.on("error", () => {});
    child.on("exit", () => {
      exited = true;
    });

    const dir = profileDir;
    return {
      mode: "app",
      close: async () => {
        try {
          if (!exited) {
            child.kill();
          }
        } catch {
          // best effort
        }
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch {
    if (profileDir) {
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
    return undefined;
  }
}

function openDefaultBrowser(url: string): ViewerWindow {
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return { mode: "browser", close: async () => {} };
  } catch {
    return { mode: "none", close: async () => {} };
  }
}
