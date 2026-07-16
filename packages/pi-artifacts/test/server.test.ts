import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createPreviewServerAccessor } from "../extensions/index.ts";
import {
  BASELINE_CSP,
  createPreviewServerState,
  type PreviewServerState,
} from "../extensions/server.ts";
import {
  loadArtifact,
  scaffoldArtifact,
  writeManifest,
} from "../extensions/store.ts";

const MARKDOWN_STACK = "markdown";
const HTML_STACK = "html";

test("preview server accessor starts lazily and single-flights creation", async (t) => {
  const root = await makeTempRoot(t);
  await scaffoldArtifact({
    title: "Scoped",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
    sessionKey: "session-a",
  });
  let creations = 0;
  const accessor = createPreviewServerAccessor(async () => {
    creations += 1;
    return createPreviewServerState(root);
  });
  t.after(() => accessor.close());

  accessor.setSessionContext({ sessionKey: "session-a", cwd: "/project" });
  assert.equal(accessor.peek(), undefined);
  assert.equal(creations, 0);

  const [first, second] = await Promise.all([accessor.get(), accessor.get()]);
  assert.equal(first, second);
  assert.equal(creations, 1);
  assert.match(await (await fetch(first.viewerUrl!)).text(), /Scoped/);

  await accessor.close();
  await accessor.close();
});

test("preview server accessor closes a retry that races shutdown", async () => {
  let creations = 0;
  let resolveSecond: ((server: PreviewServerState) => void) | undefined;
  let closes = 0;
  const fakeServer: PreviewServerState = {
    registerArtifact() {},
    unregisterArtifact() {},
    artifactUrl: () => undefined,
    hasViewerClients: () => false,
    setSessionContext() {},
    broadcastUpdate() {},
    broadcastNavigate() {},
    close: async () => {
      closes += 1;
    },
  };
  const accessor = createPreviewServerAccessor(() => {
    creations += 1;
    if (creations === 1) {
      return Promise.reject(new Error("first start failed"));
    }
    return new Promise<PreviewServerState>((resolve) => {
      resolveSecond = resolve;
    });
  });

  await assert.rejects(accessor.get(), /first start failed/);
  const retry = accessor.get();
  const retryRejected = assert.rejects(retry, /closed during startup/);
  const closing = accessor.close();
  assert.ok(resolveSecond);
  resolveSecond(fakeServer);
  await Promise.all([retryRejected, closing]);

  assert.equal(creations, 2);
  assert.equal(closes, 1);
  assert.equal(accessor.peek(), undefined);
  await assert.rejects(accessor.get(), /accessor is closed/);
});

test("preview server viewer lists store artifacts", async (t) => {
  const root = await makeTempRoot(t);
  await scaffoldArtifact({
    title: "Gallery Item",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
  });

  const server = await createPreviewServerState(root);
  t.after(() => server.close());

  assert.ok(server.viewerUrl);
  const response = await fetch(server.viewerUrl);
  const html = await response.text();

  assert.equal(response.headers.get("content-security-policy"), BASELINE_CSP);
  assert.match(html, /Pi Artifacts/);
  assert.match(html, /viewer-toolbar/);
  assert.match(html, /All artifacts/);
  assert.match(html, /Export/);
  assert.match(html, /Gallery Item/);
  assert.match(html, /Never rendered/);
  assert.match(html, /\/artifacts\/gallery-item\//);
  assert.match(html, /\/artifacts\/gallery-item\/export/);
  // Live-update script must be a served file (CSP script-src 'self' blocks
  // inline <script>), and the served file must exist.
  assert.match(html, /<script src="\/runtime\/pi\/viewer-live\.js"/);
  assert.doesNotMatch(html, /new EventSource/);
  const live = await fetch(`${server.url}/runtime/pi/viewer-live.js`);
  assert.equal(live.status, 200);
  assert.match(await live.text(), /EventSource/);
});

test("viewer filters by query, stack, and render status", async (t) => {
  const root = await makeTempRoot(t);
  const ok = await scaffoldArtifact({
    title: "Quarterly Report",
    stack: MARKDOWN_STACK,
    cwd: "/project-a",
    root,
  });
  const warned = await scaffoldArtifact({
    title: "Dashboard",
    stack: HTML_STACK,
    cwd: "/project-b",
    root,
  });
  const okArtifact = await loadArtifact(ok.id, root);
  const warnedArtifact = await loadArtifact(warned.id, root);
  await writeManifest(
    ok.id,
    {
      ...okArtifact.manifest,
      lastRender: {
        ok: true,
        warnings: 0,
        errors: 0,
        rendered: "2026-06-25T00:00:00.000Z",
      },
    },
    root,
  );
  await writeManifest(
    warned.id,
    {
      ...warnedArtifact.manifest,
      lastRender: {
        ok: true,
        warnings: 2,
        errors: 0,
        rendered: "2026-06-25T00:00:00.000Z",
      },
    },
    root,
  );

  const server = await createPreviewServerState(root);
  t.after(() => server.close());

  const stackFiltered = await (
    await fetch(`${server.viewerUrl}?stack=html&status=warnings`)
  ).text();
  assert.match(stackFiltered, /Dashboard/);
  assert.match(stackFiltered, /2 warning\(s\)/);
  assert.doesNotMatch(stackFiltered, /Quarterly Report/);

  const queryFiltered = await (
    await fetch(`${server.viewerUrl}?q=project-a`)
  ).text();
  assert.match(queryFiltered, /Quarterly Report/);
  assert.doesNotMatch(queryFiltered, /Dashboard/);
});

test("viewer filters by active session key and honors ?all", async (t) => {
  const root = await makeTempRoot(t);
  await scaffoldArtifact({
    title: "Mine",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
    sessionKey: "session-a",
  });
  await scaffoldArtifact({
    title: "Theirs",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
    sessionKey: "session-b",
  });

  const server = await createPreviewServerState(root);
  t.after(() => server.close());
  server.setSessionContext({ sessionKey: "session-a" });

  const scoped = await (await fetch(server.viewerUrl!)).text();
  assert.match(scoped, /Mine/);
  assert.doesNotMatch(scoped, /Theirs/);

  const all = await (await fetch(`${server.viewerUrl}?all`)).text();
  assert.match(all, /Mine/);
  assert.match(all, /Theirs/);

  const allByScope = await (
    await fetch(`${server.viewerUrl}?scope=all`)
  ).text();
  assert.match(allByScope, /Mine/);
  assert.match(allByScope, /Theirs/);
});

test("viewer scopes by workspace cwd", async (t) => {
  const root = await makeTempRoot(t);
  await scaffoldArtifact({
    title: "Here Doc",
    stack: MARKDOWN_STACK,
    cwd: "/project-a",
    root,
    sessionKey: "old-session",
  });
  await scaffoldArtifact({
    title: "Elsewhere Doc",
    stack: MARKDOWN_STACK,
    cwd: "/project-b",
    root,
    sessionKey: "old-session",
  });

  const server = await createPreviewServerState(root);
  t.after(() => server.close());
  server.setSessionContext({ sessionKey: "session-now", cwd: "/project-a" });

  const workspace = await (
    await fetch(`${server.viewerUrl}?scope=workspace`)
  ).text();
  assert.match(workspace, /Here Doc/);
  assert.doesNotMatch(workspace, /Elsewhere Doc/);

  // Neither artifact belongs to the active session.
  const session = await (
    await fetch(`${server.viewerUrl}?scope=session`)
  ).text();
  assert.doesNotMatch(session, /Here Doc/);
  assert.doesNotMatch(session, /Elsewhere Doc/);

  // The scope switcher shows all three scopes.
  assert.match(workspace, /This session/);
  assert.match(workspace, /This workspace/);
  assert.match(workspace, /All artifacts/);
});

test("viewer shows all sessions when no session key is set", async (t) => {
  const root = await makeTempRoot(t);
  await scaffoldArtifact({
    title: "Unscoped",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
    sessionKey: "session-x",
  });

  const server = await createPreviewServerState(root);
  t.after(() => server.close());

  const html = await (await fetch(server.viewerUrl!)).text();
  assert.match(html, /Unscoped/);
});

test("protected routes require the per-server capability path", async (t) => {
  const root = await makeTempRoot(t);
  const server = await createPreviewServerState(root);
  t.after(() => server.close());

  const missing = await fetch(`${server.url}/viewer`);
  assert.equal(missing.status, 404);
  const wrong = await fetch(`${server.url}/wrong/viewer`);
  assert.equal(wrong.status, 404);

  assert.ok(server.healthUrl);
  const health = await fetch(`${server.url}${capabilityPath(server)}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal(
    health.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );

  const rejectedMethod = await fetch(server.viewerUrl!, { method: "POST" });
  assert.equal(rejectedMethod.status, 405);
  assert.equal(rejectedMethod.headers.get("allow"), "GET, HEAD");

  const other = await createPreviewServerState(root);
  t.after(() => other.close());
  assert.notEqual(capabilityPath(server), capabilityPath(other));
});

test("events endpoint streams an update on broadcast and ends on close", async (t) => {
  const root = await makeTempRoot(t);
  const server = await createPreviewServerState(root);
  t.after(() => server.close());

  const controller = new AbortController();
  const response = await fetch(protectedServerUrl(server, "/events"), {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/event-stream/,
  );

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  // Give the connection a tick to register, then broadcast for an artifact.
  await new Promise((r) => setTimeout(r, 50));
  server.broadcastUpdate("some-artifact");

  let received = "";
  while (!received.includes("event: update")) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  assert.match(received, /event: update/);
  // The affected artifact id rides along so artifact pages can self-filter.
  assert.match(received, /data: \{"id":"some-artifact"\}/);

  // A navigate event carries the target path (auto-open window reuse).
  server.broadcastNavigate("/artifacts/some-artifact/");
  while (!received.includes("event: navigate")) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  assert.match(received, /event: navigate/);
  assert.match(received, /data: \{"path":"\/artifacts\/some-artifact\/"\}/);

  // close() must end held-open SSE responses so the server can shut down.
  await server.close();
  controller.abort();
});

test("preview server renders registered markdown artifacts with CSP", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Preview Test",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
  });
  await writeFile(
    scaffolded.entry,
    "# Hello Preview\n\n![Chart](assets/chart.svg)\n",
  );
  await mkdir(join(scaffolded.path, "assets"), { recursive: true });
  await writeFile(join(scaffolded.path, "assets", "chart.svg"), "<svg></svg>");

  const artifact = await loadArtifact(scaffolded.id, root);
  const server = await createPreviewServerState(root);
  t.after(() => server.close());
  server.registerArtifact({
    id: artifact.id,
    path: artifact.path,
    entryPath: artifact.entryPath,
    manifest: artifact.manifest,
  });

  const url = server.artifactUrl(artifact.id);
  assert.ok(url);

  const response = await fetch(url);
  assert.equal(response.headers.get("content-security-policy"), BASELINE_CSP);
  const pageHtml = await response.text();
  assert.match(pageHtml, /<h1>Hello Preview<\/h1>/);
  assert.match(pageHtml, /pi-artifact-toolbar/);
  assert.match(pageHtml, /← Gallery/);
  assert.match(pageHtml, /Export/);
  assert.match(pageHtml, new RegExp(`${artifact.id}/export`));
  // Artifact page subscribes to live reload scoped to its own id.
  assert.match(
    pageHtml,
    new RegExp(
      `<script src="/runtime/pi/viewer-live\\.js" data-artifact-id="${artifact.id}"`,
    ),
  );
  assert.doesNotMatch(pageHtml, /new EventSource/);

  const assetResponse = await fetch(`${url}assets/chart.svg`);
  assert.equal(
    assetResponse.headers.get("content-type"),
    "image/svg+xml; charset=utf-8",
  );
  assert.equal(await assetResponse.text(), "<svg></svg>");

  const encodedTraversal = await fetch(`${url}assets/%2e%2e%2fmanifest.json`);
  assert.notEqual(encodedTraversal.status, 200);
  await encodedTraversal.text();

  const externalFile = join(root, "outside.json");
  await writeFile(externalFile, '{"secret":true}');
  let symlinkCreated = false;
  try {
    await symlink(externalFile, join(scaffolded.path, "assets", "leak.json"));
    symlinkCreated = true;
  } catch (error) {
    if (
      !isNodeError(error) ||
      (error.code !== "EPERM" && error.code !== "EACCES")
    ) {
      throw error;
    }
    t.diagnostic(
      "Symlink creation is unavailable; skipping symlink confinement assertion.",
    );
  }
  if (symlinkCreated) {
    const leaked = await fetch(`${url}assets/leak.json`);
    assert.equal(leaked.status, 403);
    await leaked.text();
  }

  await writeFile(join(scaffolded.path, "assets", "app.js"), "alert(1);");
  const scriptResponse = await fetch(`${url}assets/app.js`);
  assert.equal(scriptResponse.status, 403);
  await scriptResponse.text();

  const exported = await fetch(`${url}export`);
  assert.equal(exported.status, 200);
  assert.equal(
    exported.headers.get("content-disposition"),
    `attachment; filename="${artifact.id}.html"`,
  );
  const exportHtml = await exported.text();
  assert.match(exportHtml, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(exportHtml, /(?:src|href)="\/runtime\//);
  assert.doesNotMatch(exportHtml, /(?:src|href)="assets\//);
});

test("preview server serves namespaced runtime assets and guards traversal", async (t) => {
  const root = await makeTempRoot(t);
  const server = await createPreviewServerState(root);
  t.after(() => server.close());

  const pico = await fetch(`${server.url}/runtime/pico/pico.classless.min.css`);
  assert.equal(pico.status, 200);
  assert.match(pico.headers.get("content-type") ?? "", /text\/css/);

  const chart = await fetch(`${server.url}/runtime/chartjs/chart.umd.js`);
  assert.equal(chart.status, 200);

  const hljsCss = await fetch(`${server.url}/runtime/hljs/github.min.css`);
  assert.equal(hljsCss.status, 200);
  assert.match(hljsCss.headers.get("content-type") ?? "", /text\/css/);

  const mermaid = await fetch(`${server.url}/runtime/mermaid/mermaid.min.js`);
  assert.equal(mermaid.status, 200);
  assert.match(mermaid.headers.get("content-type") ?? "", /text\/javascript/);
  // Drain the multi-megabyte body so the pooled connection is free for the
  // fetches below instead of stalling until undici gives up on it.
  const mermaidBody = await mermaid.arrayBuffer();
  assert.ok(mermaidBody.byteLength > 1_000_000);

  const mermaidInit = await fetch(`${server.url}/runtime/pi/mermaid-init.js`);
  assert.equal(mermaidInit.status, 200);

  const hydrate = await fetch(`${server.url}/runtime/pi/chart-hydrate.js`);
  assert.equal(hydrate.status, 200);

  const components = await fetch(
    `${server.url}/runtime/pi/artifact-components.js`,
  );
  assert.equal(components.status, 200);
  assert.match(await components.text(), /pi-data-source/);

  const icons = await fetch(`${server.url}/runtime/pi/icons.svg`);
  assert.equal(icons.status, 200);

  const unknown = await fetch(`${server.url}/runtime/nope/file.js`);
  assert.equal(unknown.status, 404);

  const traversal = await fetch(
    `${server.url}/runtime/pico/../../package.json`,
  );
  assert.notEqual(traversal.status, 200);
});

function protectedServerUrl(
  server: Awaited<ReturnType<typeof createPreviewServerState>>,
  path: string,
): string {
  return `${server.url}${capabilityPath(server)}${path}`;
}

function capabilityPath(
  server: Awaited<ReturnType<typeof createPreviewServerState>>,
): string {
  let viewer: URL;
  try {
    viewer = new URL(server.viewerUrl!);
  } catch {
    throw new Error("Preview server returned an invalid viewer URL.");
  }
  assert.equal(viewer.protocol, "http:");
  assert.equal(viewer.hostname, "127.0.0.1");
  assert.equal(viewer.pathname.endsWith("/viewer"), true);
  return viewer.pathname.slice(0, -"/viewer".length);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function makeTempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-artifacts-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
