import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { renderHtmlPage } from "../extensions/html.ts";
import { renderMarkdownPage } from "../extensions/markdown.ts";
import {
  BASELINE_CSP,
  createPreviewServerState,
} from "../extensions/server.ts";
import { loadArtifact, scaffoldArtifact } from "../extensions/store.ts";
import { validateHtmlArtifact } from "../extensions/validation/html.ts";

const HTML_STACK = "html";

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

test("renderHtmlPage injects the mermaid runtime only for pre.mermaid content", () => {
  const withDiagram = renderHtmlPage(
    '<pre class="mermaid">graph TD; A--&gt;B;</pre>',
    "Diagram",
  );
  assert.match(
    withDiagram,
    /<script src="\/runtime\/mermaid\/mermaid\.min\.js" defer>/,
  );
  assert.match(
    withDiagram,
    /<script src="\/runtime\/pi\/mermaid-init\.js" defer>/,
  );

  const without = renderHtmlPage("<h1>No diagrams</h1>", "Plain");
  assert.doesNotMatch(without, /mermaid/);
});

test("renderHtmlPage serves a full document verbatim", () => {
  const doc = "<!doctype html>\n<html><body><p>Whole</p></body></html>";
  assert.equal(renderHtmlPage(doc, "Ignored"), doc);
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

test("validateHtmlArtifact warns on CSP-blocked authored JavaScript", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "HTML CSP",
    stack: HTML_STACK,
    cwd: "/project",
    root,
  });
  await writeFile(
    scaffolded.entry,
    '<button onclick="go()">Go</button>\n<script>alert(1)</script>\n<script src="assets/app.js" defer></script>\n<a href="javascript:go()">bad</a>\n',
  );

  const result = await validateHtmlArtifact(scaffolded.entry);

  assert.ok(result.warnings.some((w) => w.code === "csp/inline-script"));
  assert.ok(result.warnings.some((w) => w.code === "csp/script-src"));
  assert.ok(result.warnings.some((w) => w.code === "csp/inline-handler"));
  assert.ok(result.warnings.some((w) => w.code === "csp/javascript-url"));
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
  const html = await response.text();
  assert.match(html, /<h1>Hello HTML<\/h1>/);
  assert.match(html, /pi-artifact-toolbar/);
  assert.match(html, /← Gallery/);
});

async function makeTempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-artifacts-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
