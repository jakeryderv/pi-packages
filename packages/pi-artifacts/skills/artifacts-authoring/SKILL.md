---
name: artifacts-authoring
description: How to author portable visualization artifacts for the pi-artifacts viewer. Use when creating, editing, or rendering markdown or html artifact bundles via the scaffold_artifact and render_artifact tools.
---

# Authoring Artifacts

Use this skill when creating or revising `pi-artifacts` bundles.

## Workflow

1. Call `scaffold_artifact({ type: "markdown" | "html", title })`. Choose
   `markdown` for documents/reports and `html` for dashboards, interactive
   layouts, or charts (see HTML stack below).
2. Edit the returned `entry` file directly (`index.md` or `index.html`). Do not create a new artifact for revisions.
3. Call `render_artifact({ id })`.
4. If render returns errors, fix the same entry file and call `render_artifact({ id })` again.
5. If render returns warnings, rendering still succeeded; decide whether the portability/style feedback matters for the user.
6. Use `/viewer` to open the artifact gallery (a dedicated app window when a
   Chromium-family browser is available, otherwise the default browser). The
   gallery and open artifact pages live-reload on render/delete. Use
   `/viewer-mode app|browser|off` to set and persist how the viewer opens
   (`off` just prints the URL, e.g. for SSH/headless). By default a successful
   render auto-opens the artifact (switching an already-open window to it);
   toggle this with `/viewer-auto on|off`.
7. Use `list_artifacts` to discover existing bundles, and `delete_artifact({ id })` to remove one.

The scaffold writes only structure:

```text
<artifact>/
  manifest.json
  index.md
  assets/
```

Put generated images, SVGs, and data files in `assets/` and reference them with relative paths such as `assets/chart.svg`.

## Markdown ruleset

Keep authoring portable across markdown-it, Obsidian, and GitHub.

### Tier 1 — use freely

- Headings, paragraphs, bold/italic, lists, links, images, code blocks, blockquotes
- Tables
- Task lists (`- [ ]` / `- [x]`)
- Strikethrough

### Tier 2 — safe in practice

- LaTeX math: `$...$` and `$$...$$`, common KaTeX-compatible commands only
- Mermaid fenced blocks for diagrams
- Footnotes
- GitHub/Obsidian-style callouts such as `> [!NOTE]`

### Tier 3 — avoid for portability

- Raw HTML with `class` or `style` attributes
- Wikilinks: `[[Note]]`
- Obsidian embeds: `![[file]]`
- Obsidian block references such as `^block-id`

## Visualization decision rule

- Fits a Mermaid diagram type → use a Mermaid block. This stays native, editable, and portable.
- Exceeds Mermaid, such as charts or bespoke visuals → generate an SVG/image into `assets/` and embed it:

```markdown
![Revenue by quarter](assets/revenue.svg)
```

SVG is preferred because it stays crisp and is text-based.

## Validation behavior

`render_artifact` runs format → lint → parse-check:

- Prettier formats `index.md` in place.
- markdownlint findings are warnings.
- KaTeX math parse failures are render-blocking errors.
- Portability checks warn on wikilinks, Obsidian embeds/block refs, and raw HTML styling/classes.
- Mermaid fenced blocks return a non-blocking `mermaid/not-validated` warning in MVP-1; syntax validation is deferred.

Treat `details.errors` as required fixes before preview. Treat `details.warnings` as advisory unless the user needs strict portability.

## HTML stack

Use `scaffold_artifact({ type: "html", title })` for dashboards, interactive
layouts, and charts. You author `index.html`; `render_artifact` formats it
(Prettier), lints it (HTMLHint, warn), and serves it through the same
localhost viewer. A shared runtime is injected automatically from `/runtime` —
**never vendor or `<link>`/`<script>` these yourself, and never reference a CDN**:

- **Pico CSS** (classless). Write semantic HTML — `<header>`, `<main>`,
  `<section>`, `<article>`, `<table>`, `<nav>`, `<figure>` — and it is styled
  with no classes. A `<canvas>`/`<svg>`/`<img>` is auto-fit to its container.
- **Chart.js** + a hydration script (charts; see below).
- **An icon sprite** at `/runtime/pi/icons.svg`.

### Security model — strict CSP (read before authoring)

Artifacts render under a strict Content-Security-Policy (`script-src 'self'`).
The author's html may **not** execute JavaScript. The following are blocked by
the browser and flagged as warnings by the validation gate:

- Inline `<script>` with a body (e.g. `<script>doThing()</script>`).
- Inline event handlers (`onclick=`, `onload=`, any `on*=`).
- `javascript:`-scheme URLs in `href`/`src`.

There is no JS framework (no Alpine/React/etc.). Get interactivity without JS:

- Collapsible sections: `<details><summary>Title</summary>…</details>`.
- Tabs/toggles: the hidden-`<input type="checkbox"/radio>` + `:checked` CSS
  pattern (put the toggle styles in an inline `<style>` — inline CSS is allowed).

Inline `<style>` and `style=` attributes ARE allowed. A full HTML document
(with its own `<!doctype>`/`<html>`) is served verbatim and opts OUT of the
injected runtime — only do this when you deliberately want no Pico/Chart.js.

### Charts (CSP-clean Chart.js)

Do not write chart code. Author a `<canvas data-chart>` paired with a sibling
`<script type="application/json" class="pi-chart-spec">` holding a Chart.js
config (JSON is data, not code, so it is allowed under CSP). The runtime
hydrates every such canvas:

```html
<figure>
  <canvas data-chart></canvas>
  <script type="application/json" class="pi-chart-spec">
    {
      "type": "bar",
      "data": {
        "labels": ["Q1", "Q2", "Q3", "Q4"],
        "datasets": [{ "label": "Revenue", "data": [12, 19, 14, 23] }]
      }
    }
  </script>
</figure>
```

The spec must be valid JSON (double-quoted keys, no comments, no trailing
commas, no JS function values). A `<canvas data-chart>` with no spec warns
`chart/missing-spec` and renders blank.

### Icons

Reference a sprite symbol by id; icons inherit text color via `currentColor`:

```html
<svg class="pi-icon" aria-hidden="true">
  <use href="/runtime/pi/icons.svg#check"></use>
</svg>
```

Available ids: `check`, `x`, `info`, `alert-triangle`, `arrow-up`,
`arrow-down`, `trending-up`, `trending-down`, `circle`, `external-link`.

### Static images still work

For bespoke visuals that are not a Chart.js chart, generate an SVG/image into
`assets/` and reference it with a relative path (`assets/diagram.svg`), exactly
as in the markdown lane.

### HTML validation behavior

`render_artifact` runs format -> lint -> capability-check (all advisory; html
is served regardless):

- Prettier formats `index.html` in place.
- HTMLHint findings are warnings (`htmlhint/*`).
- CSP warnings (`csp/inline-script`, `csp/inline-handler`, `csp/javascript-url`)
  flag JS that the browser will block — fix these or the behavior is silently dropped.
- `chart/missing-spec` warns a chart canvas has no JSON config.

Treat `details.warnings` as advisory, but CSP warnings indicate the page will
not behave as written — resolve them.
