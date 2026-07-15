import assert from "node:assert/strict";
import test from "node:test";

import { filterByScope, isArtifactScope } from "../extensions/scope.ts";
import type { LoadedArtifact } from "../extensions/store.ts";

function fakeArtifact(
  id: string,
  sessionKey: string | undefined,
  cwd: string,
): LoadedArtifact {
  return {
    id,
    path: `/store/${id}`,
    manifestPath: `/store/${id}/manifest.json`,
    entryPath: `/store/${id}/index.md`,
    manifest: {
      id,
      title: id,
      stack: "markdown",
      entry: "index.md",
      created: "2026-07-01T00:00:00.000Z",
      updated: "2026-07-01T00:00:00.000Z",
      cwd,
      ...(sessionKey ? { sessionKey } : {}),
    },
  };
}

const ARTIFACTS = [
  fakeArtifact("mine-here", "session-a", "/project-a"),
  fakeArtifact("mine-elsewhere", "session-a", "/project-b"),
  fakeArtifact("theirs-here", "session-b", "/project-a"),
  fakeArtifact("theirs-elsewhere", undefined, "/project-b"),
];

test("isArtifactScope accepts the three scopes and rejects everything else", () => {
  assert.ok(isArtifactScope("session"));
  assert.ok(isArtifactScope("workspace"));
  assert.ok(isArtifactScope("all"));
  assert.ok(!isArtifactScope("cwd"));
  assert.ok(!isArtifactScope(""));
});

test("filterByScope narrows by session key and by workspace cwd", () => {
  const context = { sessionKey: "session-a", cwd: "/project-a" };

  assert.deepEqual(
    filterByScope(ARTIFACTS, "session", context).map((a) => a.id),
    ["mine-here", "mine-elsewhere"],
  );
  assert.deepEqual(
    filterByScope(ARTIFACTS, "workspace", context).map((a) => a.id),
    ["mine-here", "theirs-here"],
  );
  assert.equal(filterByScope(ARTIFACTS, "all", context).length, 4);
});

test("filterByScope falls back to all when the scope anchor is unknown", () => {
  assert.equal(filterByScope(ARTIFACTS, "session", {}).length, 4);
  assert.equal(filterByScope(ARTIFACTS, "workspace", {}).length, 4);
});
