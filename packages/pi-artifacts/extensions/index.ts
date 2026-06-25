import { Type } from "typebox";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createPreviewServerState, type PreviewServerState } from "./server";
import { artifactsRoot } from "./store";

const NOT_IMPLEMENTED = "not implemented yet (scaffold stub)";

export default function (pi: ExtensionAPI) {
  let previewServer: PreviewServerState | undefined;

  // Background resources (the preview server) must NOT start in the factory.
  // They start here on session_start and are torn down idempotently on
  // session_shutdown. The bodies arrive in MVP-1; the anchors exist from day one.
  pi.on("session_start", async (_event, _ctx) => {
    previewServer ??= await createPreviewServerState();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    await previewServer?.close();
    previewServer = undefined;
  });

  pi.registerTool({
    name: "scaffold_artifact",
    label: "Scaffold Artifact",
    description:
      "Create an empty artifact bundle (manifest + blank entry + assets/) to author into. " +
      "Returns { id, path, entry, manifestPath }. Writes no content beyond bundle structure.",
    promptSnippet: "Create an empty artifact bundle to author into",
    parameters: Type.Object({
      type: Type.String({
        description: 'Artifact stack. MVP-1 supports "markdown".',
      }),
      title: Type.String({ description: "Human-readable artifact title." }),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      return {
        content: [
          { type: "text", text: `scaffold_artifact: ${NOT_IMPLEMENTED}` },
        ],
        details: { storeRoot: artifactsRoot() },
      };
    },
  });

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
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      return {
        content: [
          { type: "text", text: `render_artifact: ${NOT_IMPLEMENTED}` },
        ],
        details: { ok: false, warnings: [], errors: [] },
      };
    },
  });

  pi.registerCommand("viewer", {
    description: "Open the artifacts viewer (scoped to the current session)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`/viewer: ${NOT_IMPLEMENTED}`, "info");
    },
  });
}
