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
import { isPathInside } from "../extensions/path-safety.ts";
import {
  deleteArtifact,
  listArtifacts,
  loadArtifact,
  scaffoldArtifact,
  writeManifest,
} from "../extensions/store.ts";

const MARKDOWN_STACK = "markdown";
const HTML_STACK = "html";

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

test("isArtifactManifest accepts last render status metadata", () => {
  const manifest = createManifest({
    id: "q4-revenue",
    title: "Q4 Revenue",
    stack: MARKDOWN_STACK,
    entry: "index.md",
    cwd: "/home/me/project",
    now: new Date("2026-06-24T00:00:00.000Z"),
  });

  assert.equal(
    isArtifactManifest({
      ...manifest,
      lastRender: {
        ok: true,
        warnings: 1,
        errors: 0,
        rendered: "2026-06-25T00:00:00.000Z",
        warningCodes: ["markdownlint"],
      },
    }),
    true,
  );
  assert.equal(
    isArtifactManifest({ ...manifest, lastRender: { ok: true } }),
    false,
  );
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

test("loadArtifact rejects traversal ids and manifest entry traversal", async (t) => {
  const root = await makeTempRoot(t);
  const scaffolded = await scaffoldArtifact({
    title: "Traversal",
    stack: MARKDOWN_STACK,
    cwd: "/project",
    root,
  });
  const loaded = await loadArtifact(scaffolded.id, root);

  await assert.rejects(
    () => loadArtifact("../escape", root),
    /Invalid artifact id/,
  );

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
