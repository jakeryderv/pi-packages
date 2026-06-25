import assert from "node:assert/strict";
import test from "node:test";

import { createManifest, isArtifactManifest } from "../extensions/manifest.ts";
import { isPathInside } from "../extensions/server.ts";
import { slugifyTitle, suffixSlug } from "../extensions/slug.ts";

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
    stack: "markdown",
    entry: "index.md",
    cwd: "/home/me/project",
    now,
    sessionFile: "/home/me/.pi/agent/sessions/session.jsonl",
    sessionKey: "session-key",
  });

  assert.deepEqual(manifest, {
    id: "q4-revenue",
    title: "Q4 Revenue",
    stack: "markdown",
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
    stack: "markdown",
    entry: "index.md",
    cwd: "/home/me/project",
    now: new Date("2026-06-24T00:00:00.000Z"),
  });

  assert.equal(isArtifactManifest(validManifest), true);
  assert.equal(isArtifactManifest({ ...validManifest, stack: "html" }), false);
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
