---
name: artifacts-authoring
description: How to author portable visualization artifacts for the pi-artifacts viewer. Use when creating, editing, or rendering markdown artifact bundles via the scaffold_artifact and render_artifact tools.
---

# Authoring Artifacts

Use this skill when creating or revising `pi-artifacts` bundles.

## Workflow

1. Call `scaffold_artifact({ type: "markdown", title })`.
2. Edit the returned `entry` file directly. Do not create a new artifact for revisions.
3. Call `render_artifact({ id })`.
4. If render returns errors, fix the same entry file and call `render_artifact({ id })` again.
5. If render returns warnings, rendering still succeeded; decide whether the portability/style feedback matters for the user.
6. Use `/viewer` to open the artifact gallery (a dedicated app window when a
   Chromium-family browser is available, otherwise the default browser).
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

Not available in MVP-1. Use markdown artifacts unless/until `type: "html"` is added.
