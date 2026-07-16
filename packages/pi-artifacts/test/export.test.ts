import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  renderArtifactExport,
  writeArtifactExport,
} from "../extensions/export.ts";
import { loadArtifact, scaffoldArtifact } from "../extensions/store.ts";

test("markdown export inlines runtime CSS, fonts, and bundle assets", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Portable Report",
    stack: "markdown",
    cwd: "/project",
    root,
  });
  await writeFile(
    scaffolded.entry,
    "# Portable\n\nInline math: $x^2$.\n\n![Chart](assets/chart.svg)\n",
  );
  await writeFile(
    join(scaffolded.path, "assets", "chart.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Chart</text></svg>',
  );

  const html = await renderArtifactExport(
    await loadArtifact(scaffolded.id, root),
  );

  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /font-src data:/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /(?:src|href)="\/runtime\//);
  assert.doesNotMatch(html, /(?:src|href)="assets\//);
  assert.doesNotMatch(html, /pi-artifact-toolbar|viewer-live\.js/);
});

test("html export embeds component feeds, scripts, and the icon sprite", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Portable Dashboard",
    stack: "html",
    cwd: "/project",
    root,
  });
  await writeFile(
    scaffolded.entry,
    '<pi-data-source name="sales" src="assets/sales.json"></pi-data-source><pi-metric label="Revenue" data-feed="sales" field="total"></pi-metric><svg class="pi-icon"><use href="/runtime/pi/icons.svg#check"></use></svg><img srcset="assets/pixel.png 1x, assets/pixel.png 2x" alt="Responsive pixel">',
  );
  await writeFile(
    join(scaffolded.path, "assets", "sales.json"),
    '{"total":42}',
  );
  await writeFile(
    join(scaffolded.path, "assets", "pixel.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );

  const html = await renderArtifactExport(
    await loadArtifact(scaffolded.id, root),
  );

  assert.match(html, /data-pi-export-json="{&quot;total&quot;:42}"/);
  assert.match(html, /<symbol id="check"/);
  assert.match(html, /<use href="#check"/);
  assert.match(html, /srcset="data:image\/png;base64,/);
  assert.match(html, /script-src 'nonce-[^']+'/);
  assert.match(html, /<script nonce="[^"]+" data-pi-runtime=/);
  assert.match(html, /data-pi-runtime="\/runtime\/chartjs\/chart\.umd\.js"/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href=/);
  assert.doesNotMatch(html, /src="assets\//);
});

test("full-document export adds the safety CSP and removes authored execution", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Full Document",
    stack: "html",
    cwd: "/project",
    root,
  });
  await writeFile(
    scaffolded.entry,
    '<!doctype html><html><body onload="globalThis.authored=true"><script>globalThis.authored = true</script><script data-pi-runtime="forged">globalThis.forged = true</script><a href="javascript:alert(1)">Bad</a><a href=javascript:alert(2)>Also bad</a><img src="assets/pixel.png"></body></html>',
  );
  await writeFile(
    join(scaffolded.path, "assets", "pixel.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );

  const html = await renderArtifactExport(
    await loadArtifact(scaffolded.id, root),
  );

  assert.match(html, /script-src 'nonce-[^']+'/);
  assert.doesNotMatch(
    html,
    /globalThis\.authored|globalThis\.forged|javascript:alert/,
  );
  assert.match(html, /<a href="#">Bad<\/a>/);
  assert.match(html, /<a href="#">Also bad<\/a>/);
  assert.match(html, /data:image\/png;base64,/);
});

test("export attribute cleanup does not alter displayed code", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Code Sample",
    stack: "markdown",
    cwd: "/project",
    root,
  });
  await writeFile(
    scaffolded.entry,
    'Example: `<button onclick="run()">Run</button>`\n',
  );

  const html = await renderArtifactExport(
    await loadArtifact(scaffolded.id, root),
  );

  assert.match(
    html,
    /&lt;button onclick=&quot;run\(\)&quot;&gt;Run&lt;\/button&gt;/,
  );
});

test("writeArtifactExport uses a stable path inside the bundle", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Written Export",
    stack: "markdown",
    cwd: "/project",
    root,
  });
  await writeFile(scaffolded.entry, "# Written\n");
  const artifact = await loadArtifact(scaffolded.id, root);

  const first = await writeArtifactExport(artifact);
  const second = await writeArtifactExport(artifact);

  assert.equal(
    first.path,
    join(scaffolded.path, "exports", "written-export.html"),
  );
  assert.equal(second.path, first.path);
  assert.equal((await stat(first.path)).isFile(), true);
  assert.equal(
    first.bytes,
    Buffer.byteLength(await readFile(first.path, "utf8")),
  );
});

async function makeTempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-artifacts-export-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
