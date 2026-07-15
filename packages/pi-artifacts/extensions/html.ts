import { RUNTIME_URLS } from "./runtime.ts";
import {
  artifactChromeStyles,
  renderArtifactToolbar,
  type ArtifactPageChrome,
} from "./viewer-ui.ts";

/**
 * html render path (Phase C, Pass 2).
 *
 * The authored `index.html` body is served inside a shared page shell that
 * injects the html runtime from `/runtime` (never vendored per bundle):
 *   - Pico CSS (classless semantic base) — authored markup styles itself.
 *   - Chart.js + a CSP-clean hydration script — charts are authored as a
 *     <canvas data-chart> plus a sibling <script type="application/json">
 *     spec; no executable JS in the authored source.
 *   - An inline-SVG icon sprite referenced via <use href=".../icons.svg#name">.
 *
 * Posture: the baseline CSP stays strict (`script-src 'self'`, no
 * `unsafe-eval`). No JS framework. All scripts are served from this origin;
 * inline `<script>` and `onclick=` in authored html are blocked by CSP and
 * flagged by the validation gate. Interactivity is CSS-driven
 * (`<details>`, `:checked`).
 *
 * If the authored source is a full HTML document (has its own `<html>`/`<body>`)
 * it is served verbatim — an escape hatch that opts out of the shared runtime.
 */
export function renderHtmlPage(
  html: string,
  title: string,
  artifact?: string | ArtifactPageChrome,
): string {
  if (isFullDocument(html)) {
    // Served verbatim (opts out of the shared shell), so it also opts out of
    // live reload — we do not inject into author-owned documents.
    return html;
  }

  const escapedTitle = escapeHtml(title);
  const artifactId = typeof artifact === "string" ? artifact : artifact?.id;
  const viewerBase =
    typeof artifact === "object" ? (artifact.basePath ?? "") : "";
  const toolbar =
    typeof artifact === "object" ? renderArtifactToolbar(artifact) : "";
  const liveReload = artifactId
    ? `<script src="${RUNTIME_URLS.viewerLiveJs}" data-artifact-id="${escapeHtml(artifactId)}" data-viewer-base="${escapeHtml(viewerBase)}" defer></script>\n`
    : "";
  // The mermaid bundle is multi-megabyte; only pages that author a
  // <pre class="mermaid"> diagram pay for it.
  const mermaidRuntime = hasMermaidBlock(html)
    ? `<script src="${RUNTIME_URLS.mermaidJs}" defer></script>\n<script src="${RUNTIME_URLS.mermaidInitJs}" defer></script>\n`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle}</title>
<link rel="stylesheet" href="${RUNTIME_URLS.picoCss}">
<style>
:root { --pico-spacing: 1rem; }
body { max-width: 72rem; margin: 0 auto; padding: 2rem; }
img, svg, canvas { max-width: 100%; height: auto; }
figure { margin: 1.5rem 0; }
.pi-icon { width: 1.2em; height: 1.2em; vertical-align: -0.2em; }
pi-data-source { display: none; }
pi-grid { display: grid; grid-template-columns: repeat(var(--pi-grid-columns, 1), minmax(0, 1fr)); gap: 1rem; margin: 1rem 0; }
pi-grid[columns="2"] { --pi-grid-columns: 2; }
pi-grid[columns="3"] { --pi-grid-columns: 3; }
pi-grid[columns="4"] { --pi-grid-columns: 4; }
pi-card, pi-metric, pi-chart, pi-table { display: block; min-width: 0; }
pi-card, pi-metric { padding: 1rem; border: 1px solid var(--pico-muted-border-color); border-radius: var(--pico-border-radius); background: var(--pico-card-background-color); }
.pi-metric-label, .pi-metric-trend { display: block; color: var(--pico-muted-color); }
.pi-metric-value { display: block; margin: 0.2rem 0; font-size: clamp(1.5rem, 4vw, 2.5rem); line-height: 1.1; }
.pi-component-error { color: #dc2626; }
@media (max-width: 720px) { pi-grid { --pi-grid-columns: 1 !important; } }
${artifactChromeStyles()}
</style>
<script src="${RUNTIME_URLS.chartJs}" defer></script>
<script src="${RUNTIME_URLS.chartHydrateJs}" defer></script>
<script src="${RUNTIME_URLS.artifactComponentsJs}" defer></script>
${mermaidRuntime}${liveReload}</head>
<body>
${toolbar}
${html}
</body>
</html>
`;
}

function isFullDocument(html: string): boolean {
  return /<!doctype\s+html|<html[\s>]/i.test(html);
}

function hasMermaidBlock(html: string): boolean {
  return /<pre\b[^>]*\bclass\s*=\s*["'][^"']*\bmermaid\b/i.test(html);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
