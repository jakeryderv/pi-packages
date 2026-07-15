import type { ArtifactRenderStatus, ArtifactStack } from "./types.ts";

export interface ArtifactPageChrome {
  id: string;
  title: string;
  stack: ArtifactStack;
  lastRender?: ArtifactRenderStatus;
  /** Per-server capability path that protects viewer and artifact content. */
  basePath?: string;
}

export function artifactChromeStyles(): string {
  return `.pi-artifact-toolbar { position: sticky; top: 0; z-index: 1000; display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: -2rem -2rem 2rem; padding: 0.75rem 2rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, Canvas); background: color-mix(in srgb, Canvas 92%, transparent); backdrop-filter: blur(10px); }
.pi-artifact-toolbar a { font-size: 0.95rem; font-weight: 650; }
.pi-artifact-toolbar-title { min-width: 0; flex: 1; }
.pi-artifact-toolbar-title strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-artifact-toolbar-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.2rem; }
.pi-artifact-toolbar-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.65rem; }
.pi-artifact-badge { font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 999px; background: color-mix(in srgb, CanvasText 10%, Canvas); }
.pi-artifact-badge-ok { background: color-mix(in srgb, green 25%, Canvas); }
.pi-artifact-badge-warn { background: color-mix(in srgb, orange 30%, Canvas); }
.pi-artifact-badge-error { background: color-mix(in srgb, red 30%, Canvas); }
.pi-artifact-disabled { opacity: 0.55; cursor: not-allowed; }
.pi-artifact-scope-active { font-size: 0.95rem; font-weight: 650; opacity: 0.6; }
@media (max-width: 720px) { .pi-artifact-toolbar { align-items: stretch; flex-direction: column; } }`;
}

export function renderArtifactToolbar(input: ArtifactPageChrome): string {
  const status = renderStatusLabel(input.lastRender);
  const basePath = input.basePath ?? "";
  const artifactHref = `${basePath}/artifacts/${encodeURIComponent(input.id)}/`;

  return `<nav class="pi-artifact-toolbar" aria-label="Artifact toolbar">
  <a href="${basePath}/viewer">← Gallery</a>
  <div class="pi-artifact-toolbar-title">
    <strong>${escapeHtml(input.title)}</strong>
    <div class="pi-artifact-toolbar-meta">
      <code>${escapeHtml(input.id)}</code>
      <span class="pi-artifact-badge">${escapeHtml(input.stack)}</span>
      <span class="pi-artifact-badge ${status.className}">${status.label}</span>
    </div>
  </div>
  <div class="pi-artifact-toolbar-actions">
    <a href="${artifactHref}">Refresh</a>
    <span class="pi-artifact-disabled" aria-disabled="true" title="Export support is planned">Export</span>
  </div>
</nav>`;
}

export function renderStatusKey(
  status: ArtifactRenderStatus | undefined,
): string {
  if (!status) {
    return "never";
  }
  if (!status.ok || status.errors > 0) {
    return "errors";
  }
  if (status.warnings > 0) {
    return "warnings";
  }
  return "ok";
}

export function renderStatusLabel(status: ArtifactRenderStatus | undefined): {
  label: string;
  className: string;
} {
  switch (renderStatusKey(status)) {
    case "ok":
      return { label: "OK", className: "pi-artifact-badge-ok" };
    case "warnings":
      return {
        label: `${status?.warnings ?? 0} warning(s)`,
        className: "pi-artifact-badge-warn",
      };
    case "errors":
      return {
        label: `${status?.errors ?? 0} error(s)`,
        className: "pi-artifact-badge-error",
      };
    default:
      return { label: "Never rendered", className: "" };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
