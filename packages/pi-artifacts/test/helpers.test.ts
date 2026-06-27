import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createManifest, isArtifactManifest } from "../extensions/manifest.ts";
import { renderHtmlPage } from "../extensions/html.ts";
import { renderMarkdownPage } from "../extensions/markdown.ts";
import { isPathInside } from "../extensions/path-safety.ts";
import {
  BASELINE_CSP,
  createPreviewServerState,
} from "../extensions/server.ts";
import { slugifyTitle, suffixSlug } from "../extensions/slug.ts";
import {
  deleteArtifact,
  listArtifacts,
  loadArtifact,
  scaffoldArtifact,
  writeManifest,
} from "../extensions/store.ts";
import { validateHtmlArtifact } from "../extensions/validation/html.ts";
import { validateMarkdownArtifact } from "../extensions/validation/markdown.ts";
import {
  isViewerMode,
  readAutoOpen,
  readViewerMode,
  writeAutoOpen,
  writeViewerMode,
} from "../extensions/viewer-config.ts";
import {
  buildAppWindowArgs,
  openViewerWindow,
} from "../extensions/viewer-launcher.ts";

const MARKDOWN_STACK = "markdown";
const HTML_STACK = "html";

test("buildAppWindowArgs builds an isolated chromeless app window", () => {
  assert.deepEqual(buildAppWindowArgs("http://x/viewer", "/tmp/profile"), [
    "--app=http://x/viewer",
    "--user-data-dir=/tmp/profile",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
  ]);
});

test("openViewerWindow uses app mode when a Chromium-family browser resolves", async () => {
  const previous = process.env.PI_ARTIFACTS_BROWSER;
  process.env.PI_ARTIFACTS_BROWSER = "true";
  try {
    const window = await openViewerWindow("http://127.0.0.1:9/viewer");
    assert.equal(window.mode, "app");
    await window.close();
  } finally {
    if (previous === undefined) {
      delete process.env.PI_ARTIFACTS_BROWSER;
    } else {
      process.env.PI_ARTIFACTS_BROWSER = previous;
    }
  }
});

test("openViewerWindow honors preferred=none and the env override beats it", async () => {
  const previousViewer = process.env.PI_ARTIFACTS_VIEWER;
  delete process.env.PI_ARTIFACTS_VIEWER;
  try {
    // Persisted preference "none" -> never launches, just reports the URL.
    const off = await openViewerWindow("http://127.0.0.1:9/viewer", "none");
    assert.equal(off.mode, "none");
    await off.close();

    // Env override wins over the preferred argument.
    process.env.PI_ARTIFACTS_VIEWER = "none";
    const overridden = await openViewerWindow(
      "http://127.0.0.1:9/viewer",
      "app",
    );
    assert.equal(overridden.mode, "none");
    await overridden.close();
  } finally {
    if (previousViewer === undefined) {
      delete process.env.PI_ARTIFACTS_VIEWER;
    } else {
      process.env.PI_ARTIFACTS_VIEWER = previousViewer;
    }
  }
});

test("viewer-config persists and validates the viewer mode", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-viewercfg-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "config.json");

  // Missing file -> no preference.
  assert.equal(await readViewerMode(path), undefined);

  await writeViewerMode("browser", path);
  assert.equal(await readViewerMode(path), "browser");

  await writeViewerMode("none", path);
  assert.equal(await readViewerMode(path), "none");

  // Corrupt / unknown values -> treated as no preference, never throws.
  await writeFile(path, '{"viewerMode":"bogus"}');
  assert.equal(await readViewerMode(path), undefined);
  await writeFile(path, "not json");
  assert.equal(await readViewerMode(path), undefined);

  assert.equal(isViewerMode("app"), true);
  assert.equal(isViewerMode("browser"), true);
  assert.equal(isViewerMode("none"), true);
  assert.equal(isViewerMode("off"), false);
});

test("viewer-config auto-open defaults on and round-trips with viewerMode", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-autoopen-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "config.json");

  // Unset -> default on.
  assert.equal(await readAutoOpen(path), true);

  await writeAutoOpen(false, path);
  assert.equal(await readAutoOpen(path), false);

  // Writing one setting must not clobber the other.
  await writeViewerMode("browser", path);
  assert.equal(await readAutoOpen(path), false);
  assert.equal(await readViewerMode(path), "browser");

  await writeAutoOpen(true, path);
  assert.equal(await readAutoOpen(path), true);
  assert.equal(await readViewerMode(path), "browser");
});

test("slugifyTitle normalizes titles into stable ids", () => {
  assert.equal(slugifyTitle("Q4 Revenue Dashboard"), "q4-revenue-dashboard");
  assert.equal(
    slugifyTitle("  Multiple --- Separators!  "),
    "multiple-separators",
  );
  assert.equal(slugifyTitle("!!!"), "artifact");
});

test("suffixSlug leaves the first id untouched and appends numeric suffixes", () => {
  assert.equal(suffixSlug("q4-revenue", 1), "q4-revenue");
  assert.equal(suffixSlug("q4-revenue", 2), "q4-revenue-2");
  assert.equal(suffixSlug("q4-revenue", 3), "q4-revenue-3");
});

test("createManifest writes required metadata with stable timestamps", () => {
  const now = new Date("2026-06-24T00:00:00.000Z");
  const manifest = createManifest({
    id: "q4-revenue",
    title: "Q4 Revenue",
    stack: MARKDOWN_STACK,
    entry: "index.md",
    cwd: "/home/me/project",
    now,
    sessionFile: "/home/me/.pi/agent/sessions/session.jsonl",
    sessionKey: "session-key",
  });

  assert.deepEqual(manifest, {
    id: "q4-revenue",
    title: "Q4 Revenue",
    stack: MARKDOWN_STACK,
    entry: "index.md",
    created: "2026-06-24T00:00:00.000Z",
    updated: "2026-06-24T00:00:00.000Z",
    cwd: "/home/me/project",
    sessionFile: "/home/me/.pi/agent/sessions/session.jsonl",
    sessionKey: "session-key",
  });
});

test("isArtifactManifest accepts valid manifests and rejects invalid shapes", () => {
  const validManifest = createManifest({
    id: "q4-revenue",
    title: "Q4 Revenue",
    stack: MARKDOWN_STACK,
    entry: "index.md",
    cwd: "/home/me/project",
    now: new Date("2026-06-24T00:00:00.000Z"),
  });

  assert.equal(isArtifactManifest(validManifest), true);
  assert.equal(isArtifactManifest({ ...validManifest, stack: "html" }), true);
  assert.equal(isArtifactManifest({ ...validManifest, stack: "pdf" }), false);
  assert.equal(isArtifactManifest({ ...validManifest, cwd: undefined }), false);
  assert.equal(isArtifactManifest(null), false);
});

test("isPathInside allows the root and descendants but rejects traversal", () => {
  const root = "/tmp/artifacts/q4-revenue";

  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, "/tmp/artifacts/q4-revenue/index.md"), true);
  assert.equal(
    isPathInside(root, "/tmp/artifacts/q4-revenue/assets/chart.svg"),
    true,
  );
  assert.equal(
    isPathInside(root, "/tmp/artifacts/q4-revenue-2/index.md"),
    false,
  );
  assert.equal(
    isPathInside(root, "/tmp/artifacts/q4-revenue/../secrets.txt"),
    false,
  );
});

test("scaffoldArtifact creates isolated bundles and handles collisions", async (t) => {
  const root = await makeTempRoot(t);
  const now = new Date("2026-06-24T00:00:00.000Z");

  const first = await scaffoldArtifact({
    title: "Q4 Revenue",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
    now,
    sessionFile: "/session.jsonl",
    sessionKey: "session-key",
  });
  const second = await scaffoldArtifact({
    title: "Q4 Revenue",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
    now,
  });

  assert.equal(first.id, "q4-revenue");
  assert.equal(second.id, "q4-revenue-2");
  assert.equal(first.entry, join(root, "q4-revenue", "index.md"));
  assert.equal(await readFile(first.entry, "utf8"), "");

  const manifest = JSON.parse(await readFile(first.manifestPath, "utf8"));
  assert.equal(manifest.sessionFile, "/session.jsonl");
  assert.equal(manifest.sessionKey, "session-key");
  assert.equal((await stat(join(first.path, "assets"))).isDirectory(), true);
});

test("listArtifacts returns valid bundles sorted by updated timestamp", async (t) => {
  const root = await makeTempRoot(t);
  const older = await scaffoldArtifact({
    title: "Older",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
    now: new Date("2026-06-24T00:00:00.000Z"),
  });
  const newer = await scaffoldArtifact({
    title: "Newer",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
    now: new Date("2026-06-25T00:00:00.000Z"),
  });
  await mkdir(join(root, "not-an-artifact"));

  const artifacts = await listArtifacts(root);

  assert.deepEqual(
    artifacts.map((artifact) => artifact.id),
    [newer.id, older.id],
  );
});

test("deleteArtifact removes a bundle and rejects traversal ids", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Deletable",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
  });

  await deleteArtifact(scaffolded.id, root);
  assert.equal((await listArtifacts(root)).length, 0);

  await assert.rejects(
    () => deleteArtifact(scaffolded.id, root),
    /does not exist/,
  );
  await assert.rejects(
    () => deleteArtifact("../escape", root),
    /Invalid artifact id/,
  );
});

test("loadArtifact rejects manifest entry traversal", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Traversal",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
  });
  const loaded = await loadArtifact(scaffolded.id, root);

  await writeManifest(
    scaffolded.id,
    { ...loaded.manifest, entry: "../secret.md" },
    root,
  );

  await assert.rejects(
    () => loadArtifact(scaffolded.id, root),
    /entry path escapes/,
  );
});

test("validateMarkdownArtifact formats, warns, and blocks invalid math", async (t) => {
  const root = await makeTempRoot(t);
  const entryPath = join(root, "index.md");
  await writeFile(
    entryPath,
    "# Title\nBad [[WikiLink]]\n\n```mermaid\ngraph TD; A-->B;\n```\n\n$\\definitelyunknown{}$\n",
  );

  const result = await validateMarkdownArtifact(entryPath);
  const formatted = await readFile(entryPath, "utf8");

  assert.match(formatted, /# Title\n\nBad/);
  assert.ok(
    result.warnings.some((warning) => warning.code.includes("wikilink")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.code === "mermaid/not-validated"),
  );
  assert.ok(result.errors.some((error) => error.code === "katex"));
});

test("validateMarkdownArtifact does not treat math exponents as block references", async (t) => {
  const root = await makeTempRoot(t);
  const entryPath = join(root, "index.md");
  await writeFile(
    entryPath,
    "Inline $E = mc^2$ and display math:\n\n$$\n\\int_0^1 x^2 dx\n$$\n\n^real-block-id\n",
  );

  const result = await validateMarkdownArtifact(entryPath);
  const blockReferenceWarnings = result.warnings.filter(
    (warning) => warning.code === "portable-markdown/block-reference",
  );

  assert.equal(blockReferenceWarnings.length, 1);
  assert.equal(blockReferenceWarnings[0]?.line, 7);
});

test("renderMarkdownPage renders task lists as checkboxes", () => {
  const html = renderMarkdownPage(
    "- [x] Done item\n- [ ] Pending item\n",
    "Tasks",
  );

  assert.match(
    html,
    /<input class="task-list-item-checkbox" disabled type="checkbox" checked>/,
  );
  assert.match(
    html,
    /<input class="task-list-item-checkbox" disabled type="checkbox">/,
  );
  assert.match(html, /class="task-list-item"/);
  assert.doesNotMatch(html, /\[x\] Done item/);
});

test("renderMarkdownPage renders GitHub-style alerts", () => {
  const html = renderMarkdownPage(
    "> [!NOTE]\n> Useful context here.\n",
    "Alert",
  );

  assert.match(html, /class="pi-alert pi-alert-note"/);
  assert.match(html, /<p class="pi-alert-title">Note<\/p>/);
  assert.match(html, /Useful context here\./);
  assert.doesNotMatch(html, /\[!NOTE\]/);
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
  assert.match(html, /Gallery Item/);
  assert.match(html, /\/artifacts\/gallery-item\//);
  // Live-update script must be a served file (CSP script-src 'self' blocks
  // inline <script>), and the served file must exist.
  assert.match(html, /<script src="\/runtime\/pi\/viewer-live\.js"/);
  assert.doesNotMatch(html, /new EventSource/);
  const live = await fetch(`${server.url}/runtime/pi/viewer-live.js`);
  assert.equal(live.status, 200);
  assert.match(await live.text(), /EventSource/);
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
});

test("renderHtmlPage wraps a fragment and injects the shared runtime", () => {
  const page = renderHtmlPage("<h1>Chart</h1>", "Dashboard");

  assert.match(page, /\/runtime\/pico\/pico\.classless\.min\.css/);
  assert.match(page, /\/runtime\/chartjs\/chart\.umd\.js/);
  assert.match(page, /\/runtime\/pi\/chart-hydrate\.js/);
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /<title>Dashboard<\/title>/);
  assert.match(page, /<h1>Chart<\/h1>/);
});

test("renderers inject id-scoped live reload only when given an id", () => {
  const htmlNoId = renderHtmlPage("<h1>X</h1>", "T");
  assert.doesNotMatch(htmlNoId, /viewer-live\.js/);
  const htmlWithId = renderHtmlPage("<h1>X</h1>", "T", "my-chart");
  assert.match(
    htmlWithId,
    /<script src="\/runtime\/pi\/viewer-live\.js" data-artifact-id="my-chart"/,
  );

  const mdNoId = renderMarkdownPage("# X", "T");
  assert.doesNotMatch(mdNoId, /viewer-live\.js/);
  const mdWithId = renderMarkdownPage("# X", "T", "my-doc");
  assert.match(
    mdWithId,
    /<script src="\/runtime\/pi\/viewer-live\.js" data-artifact-id="my-doc"/,
  );
});

test("renderHtmlPage serves a full document verbatim", () => {
  const doc = "<!doctype html>\n<html><body><p>Whole</p></body></html>";
  assert.equal(renderHtmlPage(doc, "Ignored"), doc);
});

test("scaffoldArtifact creates html bundles with an index.html entry", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "HTML Dashboard",
    stack: HTML_STACK,
    cwd: "/project",
    root,
  });

  assert.equal(scaffolded.entry, join(root, "html-dashboard", "index.html"));
  assert.equal(await readFile(scaffolded.entry, "utf8"), "");

  const manifest = JSON.parse(await readFile(scaffolded.manifestPath, "utf8"));
  assert.equal(manifest.stack, "html");
  assert.equal(manifest.entry, "index.html");

  const listed = await listArtifacts(root);
  assert.deepEqual(
    listed.map((artifact) => artifact.id),
    [scaffolded.id],
  );
});

test("validateHtmlArtifact formats in place and stays non-blocking", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "HTML Validate",
    stack: HTML_STACK,
    cwd: "/project",
    root,
  });
  await writeFile(scaffolded.entry, "<section>   <p>hello</p>    </section>");

  const result = await validateHtmlArtifact(scaffolded.entry);
  const formatted = await readFile(scaffolded.entry, "utf8");

  assert.equal(result.errors.length, 0);
  assert.equal(formatted, "<section><p>hello</p></section>\n");
});

test("validateHtmlArtifact warns on CSP-blocked inline script and handlers", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "HTML CSP",
    stack: HTML_STACK,
    cwd: "/project",
    root,
  });
  await writeFile(
    scaffolded.entry,
    '<button onclick="go()">Go</button>\n<script>alert(1)</script>\n',
  );

  const result = await validateHtmlArtifact(scaffolded.entry);

  assert.ok(result.warnings.some((w) => w.code === "csp/inline-script"));
  assert.ok(result.warnings.some((w) => w.code === "csp/inline-handler"));
  assert.equal(result.errors.length, 0);
});

test("validateHtmlArtifact allows a JSON chart spec but warns when missing", async (t) => {
  const root = await makeTempRoot(t);
  const withSpec = await scaffoldArtifact({
    title: "Chart OK",
    stack: HTML_STACK,
    cwd: "/project",
    root,
  });
  await writeFile(
    withSpec.entry,
    '<figure><canvas data-chart></canvas><script type="application/json" class="pi-chart-spec">{"type":"bar"}</script></figure>',
  );
  const okResult = await validateHtmlArtifact(withSpec.entry);
  assert.ok(!okResult.warnings.some((w) => w.code === "csp/inline-script"));
  assert.ok(!okResult.warnings.some((w) => w.code === "chart/missing-spec"));

  const missing = await scaffoldArtifact({
    title: "Chart Missing",
    stack: HTML_STACK,
    cwd: "/project",
    root,
  });
  await writeFile(
    missing.entry,
    "<figure><canvas data-chart></canvas></figure>",
  );
  const missingResult = await validateHtmlArtifact(missing.entry);
  assert.ok(
    missingResult.warnings.some((w) => w.code === "chart/missing-spec"),
  );
});

test("preview server renders registered html artifacts with CSP", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "HTML Preview",
    stack: HTML_STACK,
    cwd: "/project",
    root,
  });
  await writeFile(scaffolded.entry, "<h1>Hello HTML</h1>");

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
  assert.match(await response.text(), /<h1>Hello HTML<\/h1>/);
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

test("deleteArtifact removes an html bundle", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "HTML Deletable",
    stack: HTML_STACK,
    cwd: "/project",
    root,
  });

  await deleteArtifact(scaffolded.id, root);
  assert.equal((await listArtifacts(root)).length, 0);
});

async function makeTempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-artifacts-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
