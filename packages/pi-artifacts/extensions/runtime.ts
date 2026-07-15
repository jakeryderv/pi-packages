import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Shared client runtime, served under `/runtime/<namespace>/<path>` and never
 * vendored per artifact bundle (one copy for the whole store, mirroring the
 * original KaTeX serving). Each namespace maps to a directory root; requests
 * are confined to that root by the server's traversal guard.
 *
 * - `katex`   — KaTeX CSS + fonts (markdown math). Its CSS uses relative
 *               `url(fonts/...)`, so the whole dist tree is mounted as a unit.
 * - `chartjs` — Chart.js UMD bundle (exposes the global `Chart`).
 * - `hljs`    — highlight.js theme CSS (code is highlighted server-side).
 * - `mermaid` — Mermaid IIFE bundle (exposes the global `mermaid`).
 * - `pico`    — Pico CSS (classless semantic base for the html stack).
 * - `pi`      — this package's own runtime assets (chart/mermaid hydration,
 *               icons).
 */
export const RUNTIME_ROOTS: Record<string, string> = {
  katex: dirname(require.resolve("katex/dist/katex.min.css")),
  // `chart.js` exports block deep `./dist/*` resolution, but the package main
  // (`require` condition) resolves into dist, so its dirname is the dist root.
  chartjs: dirname(require.resolve("chart.js")),
  hljs: dirname(require.resolve("highlight.js/styles/github.min.css")),
  mermaid: dirname(require.resolve("mermaid/dist/mermaid.min.js")),
  pico: dirname(require.resolve("@picocss/pico/css/pico.classless.min.css")),
  pi: join(dirname(fileURLToPath(import.meta.url)), "runtime"),
};

/** Public URL paths for the html page shell to reference. */
export const RUNTIME_URLS = {
  katexCss: "/runtime/katex/katex.min.css",
  picoCss: "/runtime/pico/pico.classless.min.css",
  chartJs: "/runtime/chartjs/chart.umd.js",
  chartHydrateJs: "/runtime/pi/chart-hydrate.js",
  hljsCssLight: "/runtime/hljs/github.min.css",
  hljsCssDark: "/runtime/hljs/github-dark.min.css",
  mermaidJs: "/runtime/mermaid/mermaid.min.js",
  mermaidInitJs: "/runtime/pi/mermaid-init.js",
  viewerLiveJs: "/runtime/pi/viewer-live.js",
  icons: "/runtime/pi/icons.svg",
} as const;
