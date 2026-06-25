import { resolve, sep } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PREFLIGHT_WINDOW_MS = 30 * 60 * 1000;
const PREFLIGHT_COMMANDS = {
  typecheck: "npm run typecheck",
  test: "npm test",
  format: "npm run format:check",
  markdown: "npm run lint:md",
  pack: "npm run pack:artifacts",
} as const;

const RELEVANT_PROMPT_PATTERN =
  /\b(pi[- ]?artifacts?|pi packages?|package|extension|skill|prompt|manifest|publish|npm pack|viewer|scaffold|render_artifact|scaffold_artifact)\b/i;

const SHELL_WRITE_PATTERN =
  /\b(rm|mv|cp|touch|mkdir|rmdir|sed\s+-i|tee|npm\s+install)\b|>|>>/i;

type PreflightKey = keyof typeof PREFLIGHT_COMMANDS;

function normalizePath(cwd: string, path: string): string {
  return resolve(path.startsWith("/") ? path : resolve(cwd, path));
}

function isInside(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function pathTargetsGeneratedPiState(cwd: string, path: string): boolean {
  const resolved = normalizePath(cwd, path);
  return (
    isInside(resolve(cwd, ".pi", "npm"), resolved) ||
    isInside(resolve(cwd, ".pi", "git"), resolved)
  );
}

function pathTargetsProjectSettings(cwd: string, path: string): boolean {
  return normalizePath(cwd, path) === resolve(cwd, ".pi", "settings.json");
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);

  return Object.values(value as Record<string, unknown>).flatMap(
    collectStrings,
  );
}

function collectPathLikeInputs(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];

  const candidate = input as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of ["path", "filePath", "newFilePath"] as const) {
    const value = candidate[key];
    if (typeof value === "string") paths.push(value);
  }

  return paths;
}

function proposedTextMentionsLocalPackageInstall(input: unknown): boolean {
  return collectStrings(input).some((text) =>
    /(["']?\.\.?)?\/?packages\/[a-z0-9._-]+/i.test(text),
  );
}

function proposedTextMentionsRelativeDocsLinks(input: unknown): boolean {
  return collectStrings(input).some((text) =>
    /\[[^\]]+\]\((?:\.\/)?docs\//.test(text),
  );
}

function getCommand(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
}

function commandMatchesPreflight(command: string): PreflightKey | undefined {
  for (const [key, expected] of Object.entries(PREFLIGHT_COMMANDS) as Array<
    [PreflightKey, string]
  >) {
    if (command.includes(expected)) return key;
  }
  return undefined;
}

function summarizeMissingPreflight(
  lastPassed: Map<PreflightKey, number>,
): string[] {
  const now = Date.now();
  return (Object.keys(PREFLIGHT_COMMANDS) as PreflightKey[]).filter((key) => {
    const timestamp = lastPassed.get(key);
    return !timestamp || now - timestamp > PREFLIGHT_WINDOW_MS;
  });
}

export default function (pi: ExtensionAPI) {
  const lastPassedPreflight = new Map<PreflightKey, number>();

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("pi-package", "package workflow active");
  });

  pi.on("before_agent_start", async (event) => {
    if (!RELEVANT_PROMPT_PATTERN.test(event.prompt)) return;

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\nProject-local pi-package workflow reminder:" +
        "\n- Use the pi-package-authoring skill for package work when helpful." +
        "\n- Keep .pi/settings.json for external reviewed packages only; test in-repo packages with pi -e." +
        "\n- Do not edit generated .pi/npm or .pi/git state." +
        "\n- For extension code, avoid background work in factories; start session resources in session_start and tear down in session_shutdown." +
        "\n- Before handoff/publish, run typecheck, tests, format check, markdownlint, and pack dry-run.",
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const input = event.input as unknown;
    const command = getCommand(input);

    if (
      command &&
      command.includes(".pi/") &&
      /(\.pi\/npm|\.pi\/git)/.test(command) &&
      SHELL_WRITE_PATTERN.test(command)
    ) {
      return {
        block: true,
        reason:
          "Generated .pi/npm and .pi/git package-install state should not be edited directly.",
      };
    }

    if (command && /\bnpm\s+publish\b/.test(command)) {
      const missing = summarizeMissingPreflight(lastPassedPreflight);
      if (missing.length > 0) {
        return {
          block: true,
          reason: `Run fresh preflight before npm publish: ${missing.join(", ")}.`,
        };
      }
    }

    for (const path of collectPathLikeInputs(input)) {
      if (pathTargetsGeneratedPiState(ctx.cwd, path)) {
        return {
          block: true,
          reason:
            "Generated .pi/npm and .pi/git package-install state should not be edited directly.",
        };
      }

      if (
        pathTargetsProjectSettings(ctx.cwd, path) &&
        proposedTextMentionsLocalPackageInstall(input)
      ) {
        return {
          block: true,
          reason:
            "Do not add in-repo ./packages/* packages to .pi/settings.json; use pi -e for local package testing.",
        };
      }

      if (
        /packages\/[^/]+\/README\.md$/.test(normalizePath(ctx.cwd, path)) &&
        proposedTextMentionsRelativeDocsLinks(input)
      ) {
        return {
          block: true,
          reason:
            "Package README files ship without docs/ by default; use GitHub docs links or intentionally include docs/ in package files.",
        };
      }
    }
  });

  pi.on("tool_result", async (event) => {
    const command = getCommand(event.input as unknown);
    if (!command || event.isError) return;

    const key = commandMatchesPreflight(command);
    if (key) lastPassedPreflight.set(key, Date.now());
  });
}
