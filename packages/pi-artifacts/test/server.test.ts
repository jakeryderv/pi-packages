import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  BASELINE_CSP,
  createPreviewServerState,
} from "../extensions/server.ts";
import {
  loadArtifact,
  scaffoldArtifact,
  writeManifest,
} from "../extensions/store.ts";

const MARKDOWN_STACK = "markdown";
const HTML_STACK = "html";

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
  assert.match(html, /All sessions/);
  assert.match(html, /Export/);
  assert.match(html, /Gallery Item/);
  assert.match(html, /Never rendered/);
  assert.match(html, /\/artifacts\/gallery-item\//);
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
  server.setSessionKey("session-a");

  const scoped = await (await fetch(server.viewerUrl!)).text();
  assert.match(scoped, /Mine/);
  assert.doesNotMatch(scoped, /Theirs/);
  assert.match(scoped, /all sessions/);

  const all = await (await fetch(`${server.viewerUrl}?all`)).text();
  assert.match(all, /Mine/);
  assert.match(all, /Theirs/);
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

test("events endpoint streams an update on broadcast and ends on close", async (t) => {
  const root = await makeTempRoot(t);
  const server = await createPreviewServerState(root);

  const controller = new AbortController();
  const response = await fetch(`${server.url}/events`, {
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

  await writeFile(join(scaffolded.path, "assets", "app.js"), "alert(1);");
  const scriptResponse = await fetch(`${url}assets/app.js`);
  assert.equal(scriptResponse.status, 403);
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

  const hydrate = await fetch(`${server.url}/runtime/pi/chart-hydrate.js`);
  assert.equal(hydrate.status, 200);

  const icons = await fetch(`${server.url}/runtime/pi/icons.svg`);
  assert.equal(icons.status, 200);

  const unknown = await fetch(`${server.url}/runtime/nope/file.js`);
  assert.equal(unknown.status, 404);

  const traversal = await fetch(
    `${server.url}/runtime/pico/../../package.json`,
  );
  assert.notEqual(traversal.status, 200);
});

async function makeTempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-artifacts-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
