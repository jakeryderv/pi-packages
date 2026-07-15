import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getArtifactRenderer,
  isRegisteredArtifactStack,
} from "../extensions/renderer-registry.ts";
import { isArtifactId, slugifyTitle, suffixSlug } from "../extensions/slug.ts";
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

test("renderer registry owns stack entry and dispatch metadata", () => {
  assert.equal(getArtifactRenderer("markdown").entryFile, "index.md");
  assert.equal(getArtifactRenderer("html").entryFile, "index.html");
  assert.equal(isRegisteredArtifactStack("markdown"), true);
  assert.equal(isRegisteredArtifactStack("unknown"), false);
  assert.throws(() => getArtifactRenderer("unknown"), /Unsupported/);
});

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
    assert.equal(typeof window.isAlive(), "boolean");
    await window.close();
    assert.equal(window.isAlive(), false);
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

test("artifact ids are one generated slug segment", () => {
  assert.equal(isArtifactId("q4-revenue-2"), true);
  assert.equal(isArtifactId("artifact"), true);
  assert.equal(isArtifactId("artifact/assets"), false);
  assert.equal(isArtifactId("../artifact"), false);
  assert.equal(isArtifactId("Artifact"), false);
});
