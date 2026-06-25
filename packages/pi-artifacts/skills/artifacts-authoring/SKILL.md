---
name: artifacts-authoring
description: How to author portable visualization artifacts for the pi-artifacts viewer. Use when creating, editing, or rendering markdown (and later html) artifact bundles via the scaffold_artifact and render_artifact tools.
---

# Authoring Artifacts

> Scaffold stub. The full ruleset lands with MVP-1. This file establishes the
> structure the agent reads; sections below are placeholders to be filled in.

## Workflow

1. `scaffold_artifact({ type, title })` creates an empty bundle and returns its
   `id`, `path`, and `entry`. It writes no content.
2. Author content directly into the blank entry file with your normal file tools.
3. `render_artifact({ id })` validates/normalizes the bundle and previews it.
   Iterate by editing the same entry and calling `render_artifact({ id })` again.

## Markdown ruleset (MVP-1)

Keep authoring portable across markdown-it, Obsidian, and GitHub.

- **Tier 1 (use freely):** headings, bold/italic, lists, links, images, code
  blocks, blockquotes, tables, task lists, strikethrough.
- **Tier 2 (safe in practice):** LaTeX math (`$...$`, `$$...$$`, common commands
  only), Mermaid (` ```mermaid ` blocks), footnotes.
- **Tier 3 (avoid for portability):** raw HTML with CSS styling, wikilinks
  (`[[Note]]`), Obsidian embeds / block references / custom callout types.

### Visualization

- Fits a Mermaid diagram type → use a Mermaid block (native, editable, portable).
- Exceeds Mermaid (charts, custom viz) → embed a pre-rendered SVG via `![](assets/chart.svg)`.

## Validation

`render_artifact` runs format → lint → parse-check and returns
`{ ok, warnings[], errors[] }`. Treat errors as render-blocking; revise and
re-render. (Tooling wiring documented with MVP-1.)

## HTML stack

Documented in MVP-2.
