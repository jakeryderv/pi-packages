import { Type } from "typebox";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isSupportedStack } from "./manifest.ts";
import { createPreviewServerState, type PreviewServerState } from "./server.ts";
import {
  artifactsRoot,
  deleteArtifact,
  deleteArtifacts,
  listArtifacts,
  loadArtifact,
  scaffoldArtifact,
  writeManifest,
} from "./store.ts";
import { getSessionFile, sessionKeyFromFile } from "./session.ts";
import { validateHtmlArtifact } from "./validation/html.ts";
import { validateMarkdownArtifact } from "./validation/markdown.ts";
import type { ArtifactRenderStatus, ValidationFinding } from "./types.ts";
import {
  openViewerWindow,
  type ViewerWindow,
  type ViewerWindowMode,
} from "./viewer-launcher.ts";
import {
  isViewerMode,
  readAutoOpen,
  readViewerMode,
  writeAutoOpen,
  writeViewerMode,
} from "./viewer-config.ts";

interface ScaffoldArtifactParams {
  type: string;
  title: string;
}

interface RenderArtifactParams {
  id: string;
}

interface DeleteArtifactParams {
  id: string;
}

interface ContextWithCwd {
  cwd?: string;
}

interface PreviewServerAccessor {
  get: () => Promise<PreviewServerState>;
  peek: () => PreviewServerState | undefined;
  close: () => Promise<void>;
}

interface ViewerWindowManager {
  open: (url: string, preferred?: ViewerWindowMode) => Promise<ViewerWindow>;
  isOpen: () => boolean;
  close: () => Promise<void>;
}

export default function (pi: ExtensionAPI) {
  const previewServer = createPreviewServerAccessor();
  const viewerWindow = createViewerWindowManager();

  registerPreviewLifecycle(pi, previewServer, viewerWindow);
  registerScaffoldTool(pi);
  registerRenderTool(pi, previewServer, viewerWindow);
  registerListTool(pi);
  registerDeleteTool(pi, previewServer);
  registerDeleteManyTool(pi, previewServer);
  registerArtifactsCleanCommand(pi, previewServer);
  registerViewerCommand(pi, previewServer, viewerWindow);
  registerViewerModeCommand(pi);
  registerViewerAutoCommand(pi);
}

function createViewerWindowManager(): ViewerWindowManager {
  let current: ViewerWindow | undefined;

  return {
    async open(url, preferred) {
      await current?.close();
      current = await openViewerWindow(url, preferred);
      return current;
    },
    isOpen() {
      // A "none" window never actually launched anything to reuse.
      return current !== undefined && current.mode !== "none";
    },
    async close() {
      await current?.close();
      current = undefined;
    },
  };
}

function createPreviewServerAccessor(): PreviewServerAccessor {
  let previewServer: PreviewServerState | undefined;

  return {
    async get() {
      previewServer ??= await createPreviewServerState();
      return previewServer;
    },
    peek() {
      return previewServer;
    },
    async close() {
      await previewServer?.close();
      previewServer = undefined;
    },
  };
}

function registerPreviewLifecycle(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
  viewerWindow: ViewerWindowManager,
): void {
  // Background resources (the preview server) must NOT start in the factory.
  // They start here on session_start and are torn down idempotently on
  // session_shutdown. render_artifact also lazily starts the server if needed.
  pi.on("session_start", async (_event, ctx) => {
    const server = await previewServer.get();
    const sessionFile = getSessionFile(ctx);
    server.setSessionKey(
      sessionFile ? sessionKeyFromFile(sessionFile) : undefined,
    );
    // A new/resumed/forked session changes the active scope; nudge any open
    // viewer to re-fetch its (now differently scoped) list.
    server.broadcastUpdate();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    await viewerWindow.close();
    await previewServer.close();
  });
}

function registerScaffoldTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "scaffold_artifact",
    label: "Scaffold Artifact",
    description:
      "Create an empty artifact bundle (manifest + blank entry + assets/) to author into. " +
      "Returns { id, path, entry, manifestPath }. Writes no content beyond bundle structure.",
    promptSnippet: "Create an empty artifact bundle to author into",
    parameters: Type.Object({
      type: Type.Union([Type.Literal("markdown"), Type.Literal("html")], {
        description:
          'Artifact stack. "markdown" (Prettier/markdownlint/KaTeX pipeline) ' +
          'or "html" (authored index.html served under the baseline CSP).',
      }),
      title: Type.String({ description: "Human-readable artifact title." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeScaffoldArtifact(params as ScaffoldArtifactParams, ctx);
    },
  });
}

async function executeScaffoldArtifact(
  input: ScaffoldArtifactParams,
  ctx: unknown,
) {
  if (!isSupportedStack(input.type)) {
    throw new Error(`Unsupported artifact type: ${input.type}`);
  }

  const sessionFile = getSessionFile(ctx);
  const details = await scaffoldArtifact({
    title: input.title,
    stack: input.type,
    cwd: (ctx as ContextWithCwd).cwd ?? process.cwd(),
    sessionFile,
    sessionKey: sessionFile ? sessionKeyFromFile(sessionFile) : undefined,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `Created ${input.type} artifact ${details.id} at ${details.path}. Author content in ${details.entry}, then call render_artifact with id "${details.id}".`,
      },
    ],
    details,
  };
}

function registerRenderTool(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
  viewerWindow: ViewerWindowManager,
): void {
  pi.registerTool({
    name: "render_artifact",
    label: "Render Artifact",
    description:
      "Validate and normalize an authored bundle, then surface it in the viewer. " +
      "Returns { ok, warnings, errors, url? }. Re-render in place by passing the same id.",
    promptSnippet: "Validate and preview an authored artifact bundle",
    parameters: Type.Object({
      id: Type.String({
        description: "Artifact id returned by scaffold_artifact.",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      return executeRenderArtifact(
        params as RenderArtifactParams,
        previewServer,
        viewerWindow,
      );
    },
  });
}

/**
 * Auto-open behavior (default on; toggle with /viewer-auto): after a render,
 * show the artifact. Reuse an already-open window by pushing a `navigate`
 * event (no new window, no flicker); otherwise launch one pointed at the
 * artifact. Honors the saved viewer mode — a "none"/off preference launches
 * nothing, so SSH/headless stays quiet.
 */
async function maybeAutoOpen(
  server: PreviewServerState,
  viewerWindow: ViewerWindowManager,
  artifactId: string,
  artifactUrl: string,
): Promise<void> {
  if (!(await readAutoOpen())) {
    return;
  }

  if (viewerWindow.isOpen()) {
    server.broadcastNavigate(`/artifacts/${encodeURIComponent(artifactId)}/`);
    return;
  }

  const preferred = await readViewerMode();
  if (preferred === "none") {
    return;
  }
  await viewerWindow.open(artifactUrl, preferred);
}

async function executeRenderArtifact(
  input: RenderArtifactParams,
  previewServer: PreviewServerAccessor,
  viewerWindow: ViewerWindowManager,
) {
  try {
    const artifact = await loadArtifact(input.id);
    const validation = await validateArtifact(
      artifact.manifest.stack,
      artifact.entryPath,
    );

    const rendered = new Date().toISOString();
    const renderStatus = summarizeRenderStatus({
      ok: validation.errors.length === 0,
      warnings: validation.warnings,
      errors: validation.errors,
      rendered,
    });
    const updatedManifest = {
      ...artifact.manifest,
      updated: rendered,
      lastRender: renderStatus,
    };
    await writeManifest(artifact.id, updatedManifest);

    if (validation.errors.length > 0) {
      previewServer.peek()?.broadcastUpdate(artifact.id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Artifact ${input.id} has ${validation.errors.length} render-blocking error(s) and was not previewed.`,
          },
        ],
        details: { ok: false, ...validation },
      };
    }

    const server = await previewServer.get();
    server.registerArtifact({
      id: artifact.id,
      path: artifact.path,
      entryPath: artifact.entryPath,
      manifest: updatedManifest,
    });
    const url = server.artifactUrl(artifact.id);
    server.broadcastUpdate(artifact.id);
    if (url) {
      await maybeAutoOpen(server, viewerWindow, artifact.id, url);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Artifact ${artifact.id} rendered successfully${
            validation.warnings.length > 0
              ? ` with ${validation.warnings.length} warning(s)`
              : ""
          }.${url ? ` Preview: ${url}` : ""}`,
        },
      ],
      details: { ok: true, ...validation, url },
    };
  } catch (error) {
    return renderFailure(error);
  }
}

function summarizeRenderStatus(input: {
  ok: boolean;
  warnings: ValidationFinding[];
  errors: ValidationFinding[];
  rendered: string;
}): ArtifactRenderStatus {
  return {
    ok: input.ok,
    warnings: input.warnings.length,
    errors: input.errors.length,
    rendered: input.rendered,
    ...(input.warnings.length > 0
      ? {
          warningCodes: [
            ...new Set(input.warnings.map((warning) => warning.code)),
          ],
        }
      : {}),
    ...(input.errors.length > 0
      ? { errorCodes: [...new Set(input.errors.map((error) => error.code))] }
      : {}),
  };
}

function renderFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return {
    content: [
      {
        type: "text" as const,
        text: `render_artifact failed: ${message}`,
      },
    ],
    details: {
      ok: false,
      warnings: [],
      errors: [
        {
          code: "render_artifact",
          message,
        },
      ],
    },
  };
}

function registerListTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_artifacts",
    label: "List Artifacts",
    description:
      "List artifact bundles in the store, newest first. " +
      "Returns { artifacts: [{ id, title, stack, updated, cwd }], count }.",
    promptSnippet: "List existing artifact bundles in the store",
    parameters: Type.Object({}),
    async execute() {
      const artifacts = await listArtifacts();
      const rows = artifacts.map((artifact) => ({
        id: artifact.id,
        title: artifact.manifest.title,
        stack: artifact.manifest.stack,
        updated: artifact.manifest.updated,
        cwd: artifact.manifest.cwd,
        lastRender: artifact.manifest.lastRender,
      }));

      const summary = rows.length
        ? rows
            .map((row) => `- ${row.id} — ${row.title} (${row.stack})`)
            .join("\n")
        : "No artifacts in the store.";

      return {
        content: [{ type: "text" as const, text: summary }],
        details: { artifacts: rows, count: rows.length },
      };
    },
  });
}

function registerDeleteTool(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
): void {
  pi.registerTool({
    name: "delete_artifact",
    label: "Delete Artifact",
    description:
      "Delete an artifact bundle and all of its files from the store. " +
      "Returns { ok, id }.",
    promptSnippet: "Delete an artifact bundle from the store",
    parameters: Type.Object({
      id: Type.String({ description: "Artifact id to delete." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const input = params as DeleteArtifactParams;
      try {
        await deleteArtifact(input.id);
        const server = previewServer.peek();
        server?.unregisterArtifact(input.id);
        server?.broadcastUpdate();
        return {
          content: [
            { type: "text" as const, text: `Deleted artifact ${input.id}.` },
          ],
          details: { ok: true, id: input.id },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `delete_artifact failed: ${message}`,
            },
          ],
          details: { ok: false, id: input.id, error: message },
        };
      }
    },
  });
}

interface DeleteArtifactsParams {
  ids?: string[];
  older_than_days?: number;
}

function registerDeleteManyTool(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
): void {
  pi.registerTool({
    name: "delete_artifacts",
    label: "Delete Artifacts",
    description:
      "Bulk-delete artifact bundles by id list and/or age. " +
      "Returns { ok, deleted, count }. Missing ids are skipped, not errors.",
    promptSnippet: "Bulk-delete artifact bundles from the store",
    parameters: Type.Object({
      ids: Type.Optional(
        Type.Array(Type.String(), {
          description: "Artifact ids to delete.",
        }),
      ),
      older_than_days: Type.Optional(
        Type.Number({
          minimum: 0,
          description:
            "Also delete every artifact whose last update is older than this many days.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const input = params as DeleteArtifactsParams;
      if (!input.ids?.length && input.older_than_days === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "delete_artifacts needs ids and/or older_than_days.",
            },
          ],
          details: { ok: false, deleted: [], count: 0 },
        };
      }

      const deleted = await deleteArtifacts({
        ids: input.ids,
        olderThan:
          input.older_than_days === undefined
            ? undefined
            : new Date(Date.now() - input.older_than_days * 86_400_000),
      });
      unregisterDeleted(previewServer, deleted);

      return {
        content: [
          {
            type: "text" as const,
            text: deleted.length
              ? `Deleted ${deleted.length} artifact(s): ${deleted.join(", ")}.`
              : "No artifacts matched.",
          },
        ],
        details: { ok: true, deleted, count: deleted.length },
      };
    },
  });
}

function registerArtifactsCleanCommand(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
): void {
  pi.registerCommand("artifacts-clean", {
    description:
      "Delete artifacts not updated in N days, e.g. /artifacts-clean 30. No argument shows the store size.",
    handler: async (args, ctx) => {
      const requested = (args ?? "").trim();

      if (!requested) {
        const count = (await listArtifacts()).length;
        ctx.ui.notify(
          `${count} artifact(s) in ${artifactsRoot()}. Delete stale ones with /artifacts-clean <days>.`,
          "info",
        );
        return;
      }

      const days = Number(requested);
      if (!Number.isFinite(days) || days < 0) {
        ctx.ui.notify(
          `"${requested}" is not a number of days. Use /artifacts-clean 30.`,
          "warning",
        );
        return;
      }

      const deleted = await deleteArtifacts({
        olderThan: new Date(Date.now() - days * 86_400_000),
      });
      unregisterDeleted(previewServer, deleted);
      ctx.ui.notify(
        deleted.length
          ? `Deleted ${deleted.length} artifact(s) older than ${days} day(s).`
          : `No artifacts older than ${days} day(s).`,
        "info",
      );
    },
  });
}

function unregisterDeleted(
  previewServer: PreviewServerAccessor,
  deleted: string[],
): void {
  const server = previewServer.peek();
  if (!server || deleted.length === 0) {
    return;
  }
  for (const id of deleted) {
    server.unregisterArtifact(id);
  }
  server.broadcastUpdate();
}

function registerViewerCommand(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
  viewerWindow: ViewerWindowManager,
): void {
  pi.registerCommand("viewer", {
    description: "Open the artifacts viewer (scoped to the current session)",
    handler: async (_args, ctx) => {
      const server = await previewServer.get();
      if (!server.viewerUrl) {
        ctx.ui.notify("Artifact viewer is unavailable.", "warning");
        return;
      }

      const preferred = await readViewerMode();
      const window = await viewerWindow.open(server.viewerUrl, preferred);
      ctx.ui.notify(
        `${viewerOpenMessage(window.mode, server.viewerUrl)} Store: ${artifactsRoot()}`,
        "info",
      );
    },
  });
}

function registerViewerModeCommand(pi: ExtensionAPI): void {
  pi.registerCommand("viewer-mode", {
    description:
      "Set how /viewer opens: app (dedicated window), browser, or off (print URL). No argument shows the current setting.",
    handler: async (args, ctx) => {
      const requested = (args ?? "").trim().toLowerCase();

      if (!requested) {
        const current = (await readViewerMode()) ?? "app (default)";
        ctx.ui.notify(
          `Viewer mode: ${current}. Set with /viewer-mode app|browser|off.`,
          "info",
        );
        return;
      }

      // Accept "off" as a friendly alias for the "none" launch mode.
      const normalized = requested === "off" ? "none" : requested;
      if (!isViewerMode(normalized)) {
        ctx.ui.notify(
          `Unknown viewer mode "${requested}". Use app, browser, or off.`,
          "warning",
        );
        return;
      }

      await writeViewerMode(normalized);
      const label = normalized === "none" ? "off (print URL only)" : normalized;
      ctx.ui.notify(`Viewer mode set to ${label}.`, "info");
    },
  });
}

function registerViewerAutoCommand(pi: ExtensionAPI): void {
  pi.registerCommand("viewer-auto", {
    description:
      "Toggle whether rendering auto-opens the artifact in the viewer: on or off. No argument shows the current setting.",
    handler: async (args, ctx) => {
      const requested = (args ?? "").trim().toLowerCase();

      if (!requested) {
        const enabled = await readAutoOpen();
        ctx.ui.notify(
          `Render auto-open is ${enabled ? "on" : "off"}. Set with /viewer-auto on|off.`,
          "info",
        );
        return;
      }

      const enable =
        requested === "on" || requested === "true" || requested === "yes";
      const disable =
        requested === "off" || requested === "false" || requested === "no";
      if (!enable && !disable) {
        ctx.ui.notify(
          `Unknown value "${requested}". Use /viewer-auto on or off.`,
          "warning",
        );
        return;
      }

      await writeAutoOpen(enable);
      ctx.ui.notify(`Render auto-open ${enable ? "on" : "off"}.`, "info");
    },
  });
}

function viewerOpenMessage(mode: ViewerWindow["mode"], url: string): string {
  switch (mode) {
    case "app":
      return `Artifact viewer opened in a dedicated window: ${url}.`;
    case "browser":
      return `Artifact viewer opened in your browser: ${url}.`;
    default:
      return `Artifact viewer: ${url} (open this URL manually).`;
  }
}

function validateArtifact(
  stack: string,
  entryPath: string,
): ReturnType<typeof validateMarkdownArtifact> {
  switch (stack) {
    case "markdown":
      return validateMarkdownArtifact(entryPath);
    case "html":
      return validateHtmlArtifact(entryPath);
  }

  throw new Error(`Unsupported artifact stack: ${stack}`);
}
