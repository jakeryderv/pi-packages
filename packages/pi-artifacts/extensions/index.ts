import { homedir } from "node:os";
import { join } from "node:path";

import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Root of the durable, cross-project artifact store.
 *
 * Derived from `CONFIG_DIR_NAME` rather than a hardcoded `.pi` so it stays
 * correct under rebranded Pi distributions. Defaults to `~/.pi/artifacts/`.
 */
function artifactsRoot(): string {
	return join(homedir(), CONFIG_DIR_NAME, "artifacts");
}

const NOT_IMPLEMENTED = "not implemented yet (scaffold stub)";

export default function (pi: ExtensionAPI) {
	// --- Lifecycle anchors -----------------------------------------------------
	// Background resources (the preview server) must NOT start in the factory.
	// They start here on session_start and are torn down idempotently on
	// session_shutdown. The bodies arrive in MVP-1; the anchors exist from day one.
	pi.on("session_start", async (_event, _ctx) => {
		// MVP-1: lazily prepare the store + preview server for this session.
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		// MVP-1: close the preview server / release session-scoped resources.
	});

	// --- Tools -----------------------------------------------------------------
	pi.registerTool({
		name: "scaffold_artifact",
		label: "Scaffold Artifact",
		description:
			"Create an empty artifact bundle (manifest + blank entry + assets/) to author into. " +
			"Returns the bundle id, path, and entry file. Writes no content.",
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
			"Returns { ok, warnings[], errors[] }. Re-render in place by passing the same id.",
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

	// --- Commands --------------------------------------------------------------
	pi.registerCommand("viewer", {
		description: "Open the artifacts viewer (scoped to the current session)",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`/viewer: ${NOT_IMPLEMENTED}`, "info");
		},
	});
}
