import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { renderHtmlPage } from "../extensions/html.ts";
import { renderMarkdownPage } from "../extensions/markdown.ts";
import { validateMarkdownArtifact } from "../extensions/validation/markdown.ts";

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

async function makeTempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-artifacts-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
