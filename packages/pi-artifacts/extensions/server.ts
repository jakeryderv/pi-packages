import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";

import { renderMarkdownPage } from "./markdown.ts";
import { isPathInside } from "./path-safety.ts";
import { artifactsRoot, listArtifacts, loadArtifact } from "./store.ts";
import type { ArtifactManifest } from "./types.ts";

const require = createRequire(import.meta.url);
const KATEX_CSS_PATH = require.resolve("katex/dist/katex.min.css");
const KATEX_DIST_ROOT = dirname(KATEX_CSS_PATH);

export const BASELINE_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
].join("; ");

interface PreviewArtifactRecord {
  id: string;
  path: string;
  entryPath: string;
  manifest: ArtifactManifest;
}

export interface PreviewServerState {
  url?: string;
  viewerUrl?: string;
  registerArtifact: (record: PreviewArtifactRecord) => void;
  unregisterArtifact: (id: string) => void;
  artifactUrl: (id: string) => string | undefined;
  close: () => Promise<void>;
}

export async function createPreviewServerState(
  root = artifactsRoot(),
): Promise<PreviewServerState> {
  const artifacts = new Map<string, PreviewArtifactRecord>();
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);

    try {
      if (!request.url) {
        sendText(response, 400, "Bad request");
        return;
      }

      const url = new URL(request.url, "http://127.0.0.1");
      await handleRequest(url, artifacts, root, response);
    } catch (error) {
      sendText(
        response,
        500,
        error instanceof Error ? error.message : "Internal server error",
      );
    }
  });

  const port = await listenLocalhost(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    url: baseUrl,
    viewerUrl: `${baseUrl}/viewer`,
    registerArtifact(record) {
      artifacts.set(record.id, record);
    },
    unregisterArtifact(id) {
      artifacts.delete(id);
    },
    artifactUrl(id) {
      return `${baseUrl}/artifacts/${encodeURIComponent(id)}/`;
    },
    close: () => closeServer(server),
  };
}

async function handleRequest(
  url: URL,
  artifacts: Map<string, PreviewArtifactRecord>,
  root: string,
  response: ServerResponse,
): Promise<void> {
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);

  if (segments.length === 0 || segments[0] === "viewer") {
    await sendViewer(root, response);
    return;
  }

  if (segments[0] === "runtime") {
    await sendRuntimeFile(segments.slice(1).join("/"), response);
    return;
  }

  if (segments[0] !== "artifacts" || !segments[1]) {
    sendText(response, 404, "Not found");
    return;
  }

  const id = segments[1];
  const artifact = await getPreviewArtifact(id, artifacts, root);
  if (!artifact) {
    sendText(response, 404, `Artifact ${id} does not exist.`);
    return;
  }

  const relativePath = segments.slice(2).join("/");
  if (!relativePath) {
    await sendRenderedArtifact(artifact, response);
    return;
  }

  await sendArtifactFile(artifact, relativePath, response);
}

async function getPreviewArtifact(
  id: string,
  artifacts: Map<string, PreviewArtifactRecord>,
  root: string,
): Promise<PreviewArtifactRecord | undefined> {
  const registered = artifacts.get(id);
  if (registered) {
    return registered;
  }

  return await loadArtifact(id, root).catch(() => undefined);
}

async function sendViewer(
  root: string,
  response: ServerResponse,
): Promise<void> {
  const artifacts = await listArtifacts(root);
  const rows = artifacts
    .map((artifact) => {
      const title = escapeHtml(artifact.manifest.title);
      const id = escapeHtml(artifact.id);
      const stack = escapeHtml(artifact.manifest.stack);
      const cwd = escapeHtml(artifact.manifest.cwd);
      const updated = escapeHtml(artifact.manifest.updated);
      const href = `/artifacts/${encodeURIComponent(artifact.id)}/`;

      return `<li>
				<a href="${href}">${title}</a>
				<small><code>${id}</code> · ${stack} · updated ${updated}</small>
				<small>${cwd}</small>
			</li>`;
    })
    .join("\n");

  sendHtml(
    response,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pi Artifacts</title>
<style>
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { max-width: 72rem; margin: 0 auto; padding: 2rem; line-height: 1.5; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 20%, Canvas); margin-bottom: 1.5rem; }
ul { list-style: none; padding: 0; }
li { padding: 1rem 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
a { font-size: 1.15rem; font-weight: 650; }
small { display: block; color: color-mix(in srgb, CanvasText 70%, Canvas); }
.empty { padding: 2rem; border: 1px dashed color-mix(in srgb, CanvasText 30%, Canvas); border-radius: 0.75rem; }
</style>
</head>
<body>
<header>
<h1>Pi Artifacts</h1>
<p>${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}</p>
</header>
${rows ? `<ul>${rows}</ul>` : `<p class="empty">No artifacts found in ${escapeHtml(root)}.</p>`}
</body>
</html>
`,
  );
}

async function sendRenderedArtifact(
  artifact: PreviewArtifactRecord,
  response: ServerResponse,
): Promise<void> {
  switch (artifact.manifest.stack) {
    case "markdown": {
      const markdown = await readFile(artifact.entryPath, "utf8");
      sendHtml(response, renderMarkdownPage(markdown, artifact.manifest.title));
      return;
    }
  }
}

async function sendRuntimeFile(
  relativePath: string,
  response: ServerResponse,
): Promise<void> {
  const filePath = resolve(KATEX_DIST_ROOT, relativePath);
  if (
    !isPathInside(KATEX_DIST_ROOT, filePath) ||
    filePath === KATEX_DIST_ROOT
  ) {
    sendText(response, 403, "Forbidden");
    return;
  }

  await sendStaticFile(filePath, response);
}

async function sendArtifactFile(
  artifact: PreviewArtifactRecord,
  relativePath: string,
  response: ServerResponse,
): Promise<void> {
  const filePath = resolve(artifact.path, relativePath);
  if (!isPathInside(artifact.path, filePath) || filePath === artifact.path) {
    sendText(response, 403, "Forbidden");
    return;
  }

  await sendStaticFile(filePath, response);
}

async function sendStaticFile(
  filePath: string,
  response: ServerResponse,
): Promise<void> {
  const fileStats = await stat(filePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!fileStats?.isFile()) {
    sendText(response, 404, "Not found");
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypeForPath(filePath));
  createReadStream(filePath).pipe(response);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", BASELINE_CSP);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function sendHtml(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(body);
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".gif":
      return "image/gif";
    case ".html":
      return "text/html; charset=utf-8";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function listenLocalhost(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Preview server did not bind to a TCP port."));
        return;
      }
      resolvePort(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    if (!server.listening) {
      resolveClose();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
