import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, resolve } from "node:path";

import { isPathInside } from "./path-safety.ts";
import { getArtifactRenderer } from "./renderer-registry.ts";
import { RUNTIME_ROOTS } from "./runtime.ts";
import {
  type ArtifactScope,
  filterByScope,
  isArtifactScope,
  type ScopeContext,
} from "./scope.ts";
import { artifactsRoot, listArtifacts, loadArtifact } from "./store.ts";
import type { ArtifactManifest } from "./types.ts";
import {
  artifactChromeStyles,
  renderStatusKey,
  renderStatusLabel,
} from "./viewer-ui.ts";

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
  healthUrl?: string;
  registerArtifact: (record: PreviewArtifactRecord) => void;
  unregisterArtifact: (id: string) => void;
  artifactUrl: (id: string) => string | undefined;
  /** Whether at least one gallery or artifact page has a live SSE connection. */
  hasViewerClients: () => boolean;
  /** Set the active session identity (key + cwd) for gallery scoping. */
  setSessionContext: (context: ScopeContext) => void;
  /**
   * Push a live `update` event to connected viewers (Phase D). Pass the
   * affected artifact id so an open artifact page reloads only when it
   * changed; the gallery reloads on any update. Omit for session/global
   * changes.
   */
  broadcastUpdate: (artifactId?: string) => void;
  /**
   * Push a `navigate` event so any open viewer switches to `pathname`
   * (e.g. a freshly rendered artifact). Powers auto-open's window reuse.
   */
  broadcastNavigate: (pathname: string) => void;
  close: () => Promise<void>;
}

/**
 * Per-request context. `sessionContext` is read fresh each request (it
 * changes on session replacement) and `sseClients` is the live transport
 * seam: the only place push reaches the viewer, kept out of the
 * renderer/store (invariants).
 */
interface RequestContext {
  artifacts: Map<string, PreviewArtifactRecord>;
  root: string;
  sseClients: Set<ServerResponse>;
  sessionContext: ScopeContext;
  accessToken: string;
  basePath: string;
}

export async function createPreviewServerState(
  root = artifactsRoot(),
): Promise<PreviewServerState> {
  const artifacts = new Map<string, PreviewArtifactRecord>();
  const sseClients = new Set<ServerResponse>();
  const accessToken = randomBytes(32).toString("base64url");
  const basePath = `/${accessToken}`;
  let sessionContext: ScopeContext = {};

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);

    try {
      if (!request.url) {
        sendText(response, 400, "Bad request");
        return;
      }

      const url = new URL(request.url, "http://127.0.0.1");
      await handleRequest(
        url,
        {
          artifacts,
          root,
          sseClients,
          sessionContext,
          accessToken,
          basePath,
        },
        request,
        response,
      );
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
    viewerUrl: `${baseUrl}${basePath}/viewer`,
    healthUrl: `${baseUrl}${basePath}/health`,
    registerArtifact(record) {
      artifacts.set(record.id, record);
    },
    unregisterArtifact(id) {
      artifacts.delete(id);
    },
    artifactUrl(id) {
      return `${baseUrl}${basePath}/artifacts/${encodeURIComponent(id)}/`;
    },
    hasViewerClients() {
      return sseClients.size > 0;
    },
    setSessionContext(context) {
      sessionContext = context;
    },
    broadcastUpdate(artifactId) {
      broadcast(sseClients, "update", artifactId);
    },
    broadcastNavigate(pathname) {
      broadcast(sseClients, "navigate", undefined, pathname);
    },
    // SSE responses are held open forever; they must be ended here or
    // `server.close()` never completes (this preserves the verified
    // no-leaked-server teardown across session replacement).
    close: async () => {
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      await closeServer(server);
    },
  };
}

async function handleRequest(
  url: URL,
  ctx: RequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const { artifacts, root, sseClients, sessionContext, accessToken, basePath } =
    ctx;
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed");
    return;
  }

  const rawSegments = decodePathSegments(url.pathname);
  if (!rawSegments) {
    sendText(response, 400, "Malformed request path");
    return;
  }

  // Package-owned runtime assets contain no user data and stay on a stable
  // path. Viewer, SSE, and artifact content require an unguessable capability
  // path so unrelated local processes cannot read the store by scanning ports.
  if (rawSegments[0] === "runtime") {
    await sendRuntimeFile(rawSegments.slice(1).join("/"), response);
    return;
  }

  if (rawSegments[0] !== accessToken) {
    sendText(response, 404, "Not found");
    return;
  }
  const segments = rawSegments.slice(1);

  if (segments[0] === "health") {
    sendJson(response, { ok: true });
    return;
  }

  if (segments[0] === "events") {
    addSseClient(sseClients, request, response);
    return;
  }

  if (segments.length === 0 || segments[0] === "viewer") {
    await sendViewer(
      root,
      sessionContext,
      url.searchParams,
      basePath,
      response,
    );
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
    await sendRenderedArtifact(artifact, basePath, response);
    return;
  }

  await sendArtifactFile(artifact, relativePath, response);
}

function decodePathSegments(pathname: string): string[] | undefined {
  try {
    const segments: string[] = [];
    for (const segment of pathname.split("/")) {
      if (!segment) {
        continue;
      }
      const decoded = decodeURIComponent(segment);
      if (
        decoded === "." ||
        decoded === ".." ||
        decoded.includes("/") ||
        decoded.includes("\\") ||
        decoded.includes("\0")
      ) {
        return undefined;
      }
      segments.push(decoded);
    }
    return segments;
  } catch {
    return undefined;
  }
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

  return loadArtifact(id, root).catch(() => undefined);
}

/**
 * SSE transport seam (Phase D). The viewer opens an `EventSource` to `/events`;
 * we hold the response open and push `update` events on render/delete/session
 * change. Unidirectional server->viewer, allowed by `connect-src 'self'`.
 */
function addSseClient(
  clients: Set<ServerResponse>,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  // Open the stream and nudge the client to retry quickly if it drops.
  response.write("retry: 2000\n\n");

  clients.add(response);
  const drop = () => {
    clients.delete(response);
  };
  request.on("close", drop);
  response.on("close", drop);
  response.on("error", drop);
}

function broadcast(
  clients: Set<ServerResponse>,
  event: string,
  artifactId?: string,
  path?: string,
): void {
  const payload: { id?: string; path?: string } = {};
  if (artifactId) {
    payload.id = artifactId;
  }
  if (path) {
    payload.path = path;
  }
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(frame);
  }
}

async function sendViewer(
  root: string,
  sessionContext: ScopeContext,
  params: URLSearchParams,
  basePath: string,
  response: ServerResponse,
): Promise<void> {
  // `?all` predates `?scope=` and stays as an alias.
  const scopeParam = params.get("scope") ?? (params.has("all") ? "all" : "");
  const scope: ArtifactScope = isArtifactScope(scopeParam)
    ? scopeParam
    : "session";
  const query = (params.get("q") ?? "").trim().toLowerCase();
  const stackFilter = params.get("stack") ?? "";
  const statusFilter = params.get("status") ?? "";
  const all = await listArtifacts(root);
  const scoped = filterByScope(all, scope, sessionContext);
  const artifacts = scoped.filter((artifact) => {
    const manifest = artifact.manifest;
    const haystack =
      `${artifact.id} ${manifest.title} ${manifest.cwd}`.toLowerCase();
    return (
      (!query || haystack.includes(query)) &&
      (!stackFilter || manifest.stack === stackFilter) &&
      (!statusFilter || renderStatusKey(manifest.lastRender) === statusFilter)
    );
  });
  const rows = artifacts
    .map((artifact) => {
      const title = escapeHtml(artifact.manifest.title);
      const id = escapeHtml(artifact.id);
      const stack = escapeHtml(artifact.manifest.stack);
      const cwd = escapeHtml(artifact.manifest.cwd);
      const updated = escapeHtml(artifact.manifest.updated);
      const href = `${basePath}/artifacts/${encodeURIComponent(artifact.id)}/`;
      const status = renderStatusLabel(artifact.manifest.lastRender);

      return `<li>
        <div class="row-title"><a href="${href}">${title}</a><span class="pi-artifact-badge">${stack}</span><span class="pi-artifact-badge ${status.className}">${status.label}</span></div>
        <small><code>${id}</code> · updated ${updated}</small>
        <small>${cwd}</small>
      </li>`;
    })
    .join("\n");
  const clearHref = viewerHref(basePath, scope);

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
.viewer-toolbar { position: sticky; top: 0; z-index: 1000; display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: -2rem -2rem 1.5rem; padding: 0.75rem 2rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, Canvas); background: color-mix(in srgb, Canvas 92%, transparent); backdrop-filter: blur(10px); }
.viewer-toolbar h1 { margin: 0; }
.viewer-toolbar-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.75rem; }
form { display: grid; grid-template-columns: minmax(12rem, 1fr) repeat(2, minmax(9rem, auto)) auto; gap: 0.75rem; margin: 0 0 1rem; }
input, select, button { font: inherit; padding: 0.45rem 0.6rem; border: 1px solid color-mix(in srgb, CanvasText 25%, Canvas); border-radius: 0.5rem; background: Canvas; color: CanvasText; }
ul { list-style: none; padding: 0; }
li { padding: 1rem 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
a { font-size: 1.15rem; font-weight: 650; }
small { display: block; color: color-mix(in srgb, CanvasText 70%, Canvas); }
.empty { padding: 2rem; border: 1px dashed color-mix(in srgb, CanvasText 30%, Canvas); border-radius: 0.75rem; }
.scope { font-size: 0.85rem; font-weight: 400; }
.scope a { font-size: inherit; font-weight: inherit; }
.row-title { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
${artifactChromeStyles()}
@media (max-width: 720px) { form { grid-template-columns: 1fr; } .viewer-toolbar { align-items: flex-start; flex-direction: column; } }
</style>
</head>
<body>
<nav class="viewer-toolbar" aria-label="Artifacts toolbar">
<h1>Pi Artifacts</h1>
<div class="viewer-toolbar-actions">
${viewerScopeSwitcher(basePath, scope)}
<a href="${viewerRefreshHref(basePath, params)}">Refresh</a>
<span class="pi-artifact-disabled" aria-disabled="true" title="Export support is planned">Export</span>
</div>
</nav>
<header>
<p>${artifacts.length} of ${scoped.length} artifact${scoped.length === 1 ? "" : "s"}
· <span class="scope">${viewerScopeLabel(scope)}</span></p>
</header>
<form method="get" action="${basePath}/viewer">
${scope === "session" ? "" : `<input type="hidden" name="scope" value="${scope}">`}
<input type="search" name="q" value="${escapeHtml(params.get("q") ?? "")}" placeholder="Search title, id, or cwd" aria-label="Search artifacts">
${viewerSelect("stack", stackFilter, [
  ["", "All stacks"],
  ["markdown", "Markdown"],
  ["html", "HTML"],
])}
${viewerSelect("status", statusFilter, [
  ["", "All statuses"],
  ["ok", "OK"],
  ["warnings", "Warnings"],
  ["errors", "Errors"],
  ["never", "Never rendered"],
])}
<button type="submit">Filter</button>
</form>
<p class="scope"><a href="${clearHref}">Clear filters</a></p>
${rows ? `<ul>${rows}</ul>` : `<p class="empty">${viewerEmptyMessage(root, basePath, scope)}</p>`}
<script src="/runtime/pi/viewer-live.js" data-viewer-base="${basePath}" defer></script>
</body>
</html>
`,
  );
}

function viewerRefreshHref(basePath: string, params: URLSearchParams): string {
  const query = params.toString();
  return query
    ? `${basePath}/viewer?${escapeHtml(query)}`
    : `${basePath}/viewer`;
}

function viewerSelect(
  name: string,
  selected: string,
  options: Array<[value: string, label: string]>,
): string {
  const optionHtml = options
    .map(([value, label]) => {
      const selectedAttr = value === selected ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selectedAttr}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return `<select name="${escapeHtml(name)}" aria-label="${escapeHtml(name)}">${optionHtml}</select>`;
}

const SCOPE_LABELS: Record<ArtifactScope, string> = {
  session: "This session",
  workspace: "This workspace",
  all: "All artifacts",
};

/** Gallery URL for a scope; session is the default and stays param-free. */
function viewerHref(basePath: string, scope: ArtifactScope): string {
  return scope === "session"
    ? `${basePath}/viewer`
    : `${basePath}/viewer?scope=${scope}`;
}

/** Three-way scope switcher; the active scope renders as plain text. */
function viewerScopeSwitcher(basePath: string, active: ArtifactScope): string {
  const scopes: ArtifactScope[] = ["session", "workspace", "all"];
  return scopes
    .map((scope) =>
      scope === active
        ? `<span class="pi-artifact-scope-active">${SCOPE_LABELS[scope]}</span>`
        : `<a href="${viewerHref(basePath, scope)}">${SCOPE_LABELS[scope]}</a>`,
    )
    .join("\n");
}

function viewerScopeLabel(scope: ArtifactScope): string {
  return SCOPE_LABELS[scope].toLowerCase();
}

function viewerEmptyMessage(
  root: string,
  basePath: string,
  scope: ArtifactScope,
): string {
  if (scope === "session") {
    return `No artifacts for this session yet. <a href="${viewerHref(basePath, "workspace")}">Show this workspace</a> or <a href="${viewerHref(basePath, "all")}">all artifacts</a>.`;
  }
  if (scope === "workspace") {
    return `No artifacts for this workspace yet. <a href="${viewerHref(basePath, "all")}">Show all artifacts</a>.`;
  }
  return `No artifacts found in ${escapeHtml(root)}.`;
}

async function sendRenderedArtifact(
  artifact: PreviewArtifactRecord,
  basePath: string,
  response: ServerResponse,
): Promise<void> {
  const source = await readFile(artifact.entryPath, "utf8");
  const renderer = getArtifactRenderer(artifact.manifest.stack);
  sendHtml(
    response,
    renderer.render(source, artifact.manifest.title, {
      id: artifact.id,
      title: artifact.manifest.title,
      stack: artifact.manifest.stack,
      lastRender: artifact.manifest.lastRender,
      basePath,
    }),
  );
}

async function sendRuntimeFile(
  relativePath: string,
  response: ServerResponse,
): Promise<void> {
  const slash = relativePath.indexOf("/");
  const namespace = slash === -1 ? relativePath : relativePath.slice(0, slash);
  const rest = slash === -1 ? "" : relativePath.slice(slash + 1);
  const root = RUNTIME_ROOTS[namespace];
  if (!root || !rest) {
    sendText(response, 404, "Not found");
    return;
  }

  const filePath = resolve(root, rest);
  if (!isPathInside(root, filePath) || filePath === root) {
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

  let realArtifactPath: string;
  let realFilePath: string;
  try {
    [realArtifactPath, realFilePath] = await Promise.all([
      realpath(artifact.path),
      realpath(filePath),
    ]);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }
    throw error;
  }
  if (!isPathInside(realArtifactPath, realFilePath)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  // Artifact bundles are content-only: executable JavaScript is available only
  // through the package-owned /runtime namespace, not author-provided files.
  if (
    extname(filePath).toLowerCase() === ".js" ||
    extname(realFilePath).toLowerCase() === ".js"
  ) {
    sendText(response, 403, "Artifact JavaScript files are not executable.");
    return;
  }

  await sendStaticFile(realFilePath, response);
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
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function sendHtml(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(body);
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
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
