import { Type } from "typebox";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isSupportedStack } from "./manifest.ts";
import { createPreviewServerState, type PreviewServerState } from "./server.ts";
import {
  artifactsRoot,
  deleteArtifact,
  listArtifacts,
  loadArtifact,
  scaffoldArtifact,
  writeManifest,
} from "./store.ts";
import { getSessionFile, sessionKeyFromFile } from "./session.ts";
import { validateHtmlArtifact } from "./validation/html.ts";
import { validateMarkdownArtifact } from "./validation/markdown.ts";
import { openViewerWindow, type ViewerWindow } from "./viewer-launcher.ts";

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
  open: (url: string) => Promise<ViewerWindow>;
  close: () => Promise<void>;
}

export default function (pi: ExtensionAPI) {
  const previewServer = createPreviewServerAccessor();
  const viewerWindow = createViewerWindowManager();

  registerPreviewLifecycle(pi, previewServer, viewerWindow);
  registerScaffoldTool(pi);
  registerRenderTool(pi, previewServer);
  registerListTool(pi);
  registerDeleteTool(pi, previewServer);
  registerViewerCommand(pi, previewServer, viewerWindow);
}

function createViewerWindowManager(): ViewerWindowManager {
  let current: ViewerWindow | undefined;

  return {
    async open(url) {
      await current?.close();
      current = await openViewerWindow(url);
      return current;
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
  pi.on("session_start", async (_event, _ctx) => {
    await previewServer.get();
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
      );
    },
  });
}

async function executeRenderArtifact(
  input: RenderArtifactParams,
  previewServer: PreviewServerAccessor,
) {
  try {
    const artifact = await loadArtifact(input.id);
    const validation = await validateArtifact(
      artifact.manifest.stack,
      artifact.entryPath,
    );

    if (validation.errors.length > 0) {
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

    const updatedManifest = {
      ...artifact.manifest,
      updated: new Date().toISOString(),
    };
    await writeManifest(artifact.id, updatedManifest);

    const server = await previewServer.get();
    server.registerArtifact({
      id: artifact.id,
      path: artifact.path,
      entryPath: artifact.entryPath,
      manifest: updatedManifest,
    });
    const url = server.artifactUrl(artifact.id);

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

      const window = await viewerWindow.open(server.viewerUrl);
      ctx.ui.notify(
        `${viewerOpenMessage(window.mode, server.viewerUrl)} Store: ${artifactsRoot()}`,
        "info",
      );
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
