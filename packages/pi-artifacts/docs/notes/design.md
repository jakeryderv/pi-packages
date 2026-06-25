# Rich Visualization Artifacts for the Pi Coding Agent

A design and build plan for a **Pi coding-agent extension** that lets the agent produce rich, visual artifacts — documents, diagrams, charts, and interactive UIs — rendered in a session-reactive viewer and stored as isolated, portable bundles.

> [!NOTE]
> The **viewer is the unifying surface**: it renders every artifact type, lets you switch between any artifact present in one place, and exports any of them to supported formats. The "stacks" below (markdown, html) are just the artifact _types_ the viewer handles today — the set is designed to grow. Cross-renderer portability (Obsidian / GitHub) is a bonus property of markdown artifacts, not a wall between types.

## At a glance

- **One viewer, many artifact types.** A unified, session-reactive viewer renders every artifact, lets you switch between any present in one place, and exports to supported formats. Two types today — `markdown` and `html` — extensible to more.
- **Two lanes today:** `markdown` is the document/note lane (portable, also opens in Obsidian/GitHub); `html` is the dynamic "generated-UI" lane.
- **Shared runtimes, content-only bundles:** the markdown renderer and a curated html runtime (semantic CSS + Alpine + charts + icons) live in the viewer, installed once — so artifacts carry only their content, and the agent writes less. Inlined on export.
- **Authoring stays declarative:** enriched markdown for documents; semantic HTML + a little Alpine for UI — no build step, no per-bundle vendoring.
- **Diagrams:** Mermaid (native, editable). Beyond Mermaid, embed a pre-rendered **SVG** via standard `![]()`.
- **Storage:** each artifact is its own content-only directory (blank entry + `assets/` + manifest), created by a scaffold that writes no content — just structure, with shared capabilities provided by the viewer.
- **Pi integration:** global session-aware store at `~/.pi/artifacts/`, the unified **session-reactive viewer** that live-updates as you switch sessions, and integrated export to any supported format.
- **Validation gate before render:** `render_artifact` formats, lints, and parse-checks the authored bundle before it is surfaced in the viewer (autofix / warn / error). The agent still writes files normally; validation gates rendering, not the original file edit.
- **Data injection:** snapshot real data works now (agent fetches → `assets/`); live/real-time updating is a parked direction (viewer-brokered push, reusing the session-sync channel).
- **Build order** is at the end, sequenced to get a usable surface early.

---

# Architecture: one viewer, pluggable artifact types

The centerpiece is a **unified viewer** that renders every artifact regardless of type, lets you switch between any artifact present in one place, and exports any of them to supported formats. Artifact _types_ are pluggable behind it — each type is a self-contained bundle plus a renderer the viewer knows how to display.

Two types exist today, chosen by output shape:

| Type (`stack`) | Entry        | Scope                                                                                 | Picks it for                                             |
| -------------- | ------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **markdown**   | `index.md`   | Enriched markdown — prose, math, tables, Mermaid, embedded SVG                        | Document/note lane; also portable to Obsidian/GitHub     |
| **html**       | `index.html` | Generated UI on a shared runtime (semantic CSS, Alpine, charts, icons), no build step | Dynamic-UI lane; dashboards, tools, forms, bespoke views |

_("Type" and "stack" are used interchangeably throughout; `stack` is the manifest field name, "type" the concept.)_

The split mirrors a single question — **is the output something to read, or something to operate?** Reading → markdown; operating → html. But both are first-class citizens in the _same_ viewer; the distinction is the renderer behind the bundle, not a separate tool. The `stack` field in the manifest is the **extension point**: adding a new type later (say, a notebook or a 3D scene) means registering a renderer, a validator, and export targets for a new `stack` value — storage, the viewer shell, session-sync, the validation gate, and export stay unchanged.

---

# The markdown stack: portable documents

Author **portable enriched markdown** — plain `.md` files that render consistently across markdown-it, Obsidian, and GitHub. A `.md` file is portable as plain text, but rich rendering comes from the _renderer_, not the file — so "portable" means restricting authoring to syntax all three renderers agree on. Cross-renderer breakage comes mainly from custom HTML/CSS styling; when the goal is visualization rather than styling, that conflict doesn't arise.

## Compatibility tiers

### Tier 1 — universal, use freely

CommonMark plus the formal GFM extensions. Renders identically everywhere.

- Headings, bold / italic, lists, links, **images**, code blocks, blockquotes
- Tables
- Task lists (`- [ ]` / `- [x]`)
- Strikethrough

### Tier 2 — widely supported, safe in practice

Not in the formal spec, but all three renderers handle them.

- **LaTeX math** (`$...$`, `$$...$$`) — common commands only (see ruleset)
- **Mermaid** (` ```mermaid ` blocks) — the shared diagram language
- **Footnotes**

### Tier 3 — renderer-specific, avoid for portability

- Raw HTML with CSS styling (GitHub strips style attributes)
- Wikilinks `[[Note]]` (Obsidian-only)
- Obsidian embeds, block references, custom callout types

## Authoring ruleset

Keep authoring within these rules and output stays portable across all three renderers:

1. **Math** → LaTeX, limited to common commands (the KaTeX ∩ MathJax overlap). Ordinary math is identical everywhere; only exotic MathJax-only macros risk breaking in a KaTeX pipeline.
2. **Diagrams** → Mermaid. The shared diagram language across all three.
3. **Tables, code, lists, task lists** → universal, use freely.
4. **Callouts** (optional) → `> [!NOTE]` style. Renders natively on GitHub and Obsidian; add a markdown-it alerts plugin to complete the trio.
5. **Avoid** → custom HTML/CSS classes, wikilinks, and other Tier 3 syntax.

## The visualization ceiling — and the escape hatch

**Mermaid is the limit of portable native visualization.** It covers a lot — flowcharts, sequence, class, state, ER, Gantt, pie, mindmaps, timelines — but it is **not** a general charting tool. Scatter plots, multi-series line charts, heatmaps, and custom diagrams fall outside its vocabulary, and no portable markdown syntax covers those across all three renderers.

When a visualization exceeds Mermaid, **generate it as an image — preferably SVG — and embed it with standard markdown:**

```markdown
![Revenue by quarter](assets/chart.svg)
```

Image embedding is Tier 1, the most universal syntax there is. Any tool can generate the image (a charting library, custom SVG, anything), then it drops in as a portable `![]()`. SVG is preferred: it stays crisp and is itself just text.

The decision rule:

| Need                                 | Approach                                            |
| ------------------------------------ | --------------------------------------------------- |
| Fits within Mermaid's diagram types  | Mermaid block — native, editable, portable          |
| Exceeds Mermaid (charts, custom viz) | Pre-rendered SVG via `![]()` — portable, but static |

**The one unavoidable tradeoff:** a pre-rendered image is static and not editable-as-text the way a Mermaid block is. A visualization that is rich-beyond-Mermaid, live-editable-as-text, **and** portable across all three renderers at once is not achievable — that's a constraint of the medium, not something a different tool fixes. When live editability and richness both matter more than portability, that's the signal to use the html stack instead.

---

# The html stack: a generated-UI runtime

This is the **dynamic-UI lane** — where the agent generates interactive interfaces ("generated UI") for maximum flexibility with minimum effort. Where markdown is the document/note lane, html is for dashboards, tools, forms, and bespoke interactive views.

The key design choice: give the html stack a **shared, installed runtime**, symmetric with markdown. Markdown artifacts are already just content — markdown-it, KaTeX, and Mermaid live in the viewer, not in each bundle. The html stack gets the same treatment: a curated runtime the viewer provides, so html artifacts also carry only their own content. This is what a real Pi package buys: capabilities installed once and shared, rather than re-vendored per bundle.

Two foundations still hold: **no build step** (avoid JSX and bundlers; the browser runs plain `.html` directly) and **declarative authoring** (the agent describes UI, it doesn't write imperative plumbing).

## The curated runtime

A small, opinionated kit — installed with the package, served by the viewer — prioritized by how much agent effort it removes:

| Capability                    | Tool (example)        | Why it earns its place                                                                                                                                                       |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Semantic CSS base**         | Pico.css (classless)  | Biggest single win — agent writes plain `<article>`, `<button>`, `<table>` and gets polished UI with **zero class names or styling decisions**. Nothing to remember.         |
| **Declarative interactivity** | Alpine (~45kb)        | State, binding, events as markup directives (`x-data`, `@click`) — no imperative DOM code.                                                                                   |
| **Charts**                    | Vega-Lite (JSON spec) | Breaks the Mermaid ceiling on the html side. A pure declarative spec — consistent with "declarative lowers agent error." Chart.js is the lighter, config-object alternative. |
| **Icons**                     | Lucide (SVG sprite)   | Clean icons dropped in by name; no asset hunting.                                                                                                                            |

That's the whole kit: **semantic CSS + Alpine + one charting lib + icons** — covering the vast majority of generated UI without a build step. A class-based component layer can sit on top of the classless base for the cases that need more control.

**Why a shared runtime is now affordable:** because it loads once (installed, served by the viewer) rather than per-bundle, the weight is amortized across every artifact. That's what makes a real charting library viable here — a cost that would be absurd to vendor into every bundle is paid once globally.

> [!NOTE]
> Scope limits: this covers the bulk of generated UI (dashboards, tools, forms, explainers) with no build step. It does **not** aim to replicate heavy-library ecosystems (full React, three.js, WebGL) that genuinely want a build, nor persistent cross-session storage or API-powered artifacts. Those stay deliberately out of scope to keep the model minimal.

## The enabler: an authoring guide

Shared capabilities only reduce agent effort **if the agent knows they exist**. A runtime the agent can't use is dead weight. So the runtime ships with a concise **authoring guide** (a Pi skill): how semantic HTML maps to the CSS base, how to drop an Alpine component, the chart-spec shape, the icon names. This guide is as important as the libraries — it's what converts "installed capability" into "low agent effort."

## Two risks to keep it honest

- **House-framework creep.** Every shared convention is something to teach the agent and maintain. A small curated set stays "minimum complexity"; a kitchen sink becomes its own framework with a learning curve — defeating the goal. Resist adding.
- **Versioning.** One shared runtime version serves all artifacts. Pin it; when bumped, existing artifacts re-render against the new version (usually fine for stable libs, but a coordination point per-bundle vendoring didn't have).

## Scaffolds: empty structure, tools available

The agent initializes an artifact from a **scaffold** — and a scaffold deliberately writes **no content**. It creates the empty bundle (dir + `manifest.json` + blank entry + `assets/`) and nothing more. Think "an empty room wired for power," not "a furnished room."

This is a deliberate choice against pre-filled templates. A skeleton with a demo counter or chart scaffold creates **gravitational pull** — the agent tends to produce something shaped like the skeleton rather than building from the actual need, which is the opposite of maximum flexibility. A blank entry with a known toolbox avoids the anchor.

There is **one scaffold per type, no variants** — and the html scaffold is the _same shape_ as the markdown one:

|                 | markdown scaffold                                      | html scaffold                                               |
| --------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| `manifest.json` | ✓                                                      | ✓                                                           |
| blank entry     | `index.md`                                             | `index.html`                                                |
| `assets/`       | ✓                                                      | ✓                                                           |
| Runtime         | injected by the viewer (markdown-it / KaTeX / Mermaid) | injected by the viewer (CSS base / Alpine / charts / icons) |

The reason html needs no "interactive variant" is the shared runtime: **there is nothing to pre-wire.** Just as a markdown artifact writes `$E=mc^2$` and never `<script src="katex.js">`, an html artifact writes semantic HTML and an `x-data` directive and never `<script src="alpine.js">`. The viewer injects the runtime at render time. The agent _uses_ capabilities (which it knows from the authoring guide); it never wires them.

So the agent's `index.html` is **just content** — no `<!doctype>`/`<head>` boilerplate, since the viewer wraps it (symmetric with `.md` being just content). Export later materializes the full standalone document.

> [!NOTE]
> **The one exception:** an artifact needing a library _outside_ the curated runtime (e.g. three.js for a 3D view) vendors it into its own `vendor/` folder. This is not a second init path — it's the same scaffold plus a dependency added _while authoring_ for a genuine need, not a variant chosen _at init_. The default is pure shared-runtime; per-artifact vendoring is a rare escape hatch for the long tail.

---

# Validation gate: enforcing the rules

The authoring rules above are only advisory if the agent has to remember them. A **validation gate** turns each rule into an enforced check — moving consistency from "documented" to "guaranteed." A rule in the authoring guide is advisory; a paired linter makes it load-bearing.

## Where it runs

Inside `render_artifact`, after the agent has authored files and before the viewer is updated: **format → lint → parse-check → surface-or-return-feedback.** Because the agent writes bundle files with its normal file tools, this gate does **not** prevent the original file edit. It can normalize/autofix the authored files and decide whether the artifact is valid enough to render.

| Outcome     | Effect                                                               | For                                            |
| ----------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| **Autofix** | Bundle files are silently normalized, then rendering proceeds        | Formatting, normalization — no judgment needed |
| **Warning** | Rendering proceeds, feedback returns to the agent                    | Portability risks, soft issues                 |
| **Error**   | Rendering is blocked, feedback returns, agent revises and re-renders | Syntax that genuinely won't render             |

This mirrors the compiler/test loop a coding agent already understands, so the feedback _teaches_ within the session — surfacing the rule at the moment it blocks or degrades rendering, not just patching output.

## Why it matters more here

- **The agent writes blind.** It can't see the render — the viewer renders elsewhere. A parse-check is the agent's only pre-flight signal that a Mermaid block or math expression will actually display. Without it, the failure mode is "looks fine to the agent, renders broken in the viewer."
- **The highest-value checks are real parses, not regexes.** Running Mermaid through its own parser and KaTeX in strict mode catches malformed diagrams/math _before_ they render as broken blocks. (Caveat: KaTeX strict runs cleanly headless in Node; **Mermaid's parser historically needs a DOM (jsdom/puppeteer)**, so its in-gate feasibility is a spike — if it can't run headless it degrades to warn-only or is skipped, never blocking. See the roadmap's Early spikes.)

## Checks per type — reuse, don't reinvent

Wire up battle-tested tools rather than writing a custom linter; they're fast, maintained, and the agent already knows their output format.

**markdown:**

- **Prettier** (autofix) — normalizes spacing, list markers, table alignment.
- **markdownlint** (warn/error) — heading levels, list nesting, malformed tables.
- **KaTeX strict** (error) — render-validity check for math; runs headless, highest value.
- **Mermaid parse** (error _if feasible_) — render-validity check for diagrams; highest value, but gated behind the headless-Node feasibility spike. Falls back to warn-only/skipped if Mermaid's parser can't run without a DOM.
- **Custom tier-check** (warn) — _your_ portability rules: Tier 3 syntax (wikilinks, styled HTML) → warning; MathJax-only macros outside the KaTeX subset → warning.

**html:**

- **Prettier** (autofix) — HTML/CSS/JS formatting.
- **HTMLHint** or similar (warn/error) — unclosed tags, bad nesting, broken attributes.
- **Custom runtime-check** (warn) — references only classes/capabilities the shared runtime actually provides; flags drift from the curated kit.

## Validation is part of the renderer contract

Each registered type declares its **formatter + linter + parse-check** alongside its renderer and export targets. A new artifact type inherits the same quality gate for free — preserving the "extensible without special-casing" property. And the authoring guide and the checks are written as a **pair**: the guide states each rule, the linter enforces it, so they never drift.

## Keeping it lightweight

The risk is this becoming a slow CI pipeline, undercutting the minimum-complexity goal. Guardrails:

- **Bias to autofix and warn.** Reserve hard errors for "will not render." Style nits never block.
- **A gate, not a pipeline.** Run only the checks the bundle's type needs, in-process, during `render_artifact`. No watch mode, no config sprawl.
- **Opinionated defaults, minimal knobs.** Ship sensible configs; don't expose a surface to manage — same philosophy as the classless CSS base.

---

# Storage: isolated bundles

Once an artifact has its own files — content, data, generated images — it stops being a single file and becomes a **bundle**. A directory per artifact isolates it.

## What lives where: global vs. bundled

The scaffold/shared-runtime model gives a clean split:

**Global — provided by the viewer, the agent never writes these:**

- Markdown renderer (markdown-it / KaTeX / Mermaid)
- html runtime (semantic CSS base, Alpine, charting lib, icons)
- The authoring guide (the skill that makes the global tools usable without pre-wiring)

**Bundled — in the isolated artifact dir, the agent writes these:**

- `manifest.json`
- `index.md` / `index.html` — blank at scaffold, filled with content by the agent
- `assets/` — the artifact's own data, images, generated SVGs
- `app.js` — _optional_, only when custom logic beyond Alpine directives is needed

There is **no `styles.css` and no `vendor/`** in a normal bundle: styling comes from the shared CSS base (the agent writes semantic HTML, not CSS), and libraries are the shared runtime. The bundle is purely the artifact's own content.

## Core principle: a self-contained directory

The unit of isolation is the **directory boundary**, made to work by **relative links**. Each artifact's own content lives inside its folder, referenced by relative path. Shared capabilities are _not_ copied in — they're provided by the viewer — so bundles stay content-only:

```
artifacts/
  some-report/         some-dashboard/        some-tool/
    manifest.json        manifest.json          manifest.json
    index.md             index.html             index.html
    assets/              assets/                app.js
      chart.svg            data.json            assets/
                           icon.svg               data.json
```

Tooling doesn't care which type — it finds `<artifact-id>/` and reads the manifest to know how to handle it.

## The manifest

One small per-artifact manifest lets tooling handle any artifact without inspecting its contents:

```json
{
  "id": "q4-dashboard",
  "title": "Q4 Revenue Dashboard",
  "stack": "html",
  "entry": "index.html",
  "sessionFile": "/home/me/.pi/agent/sessions/project/session.jsonl",
  "sessionKey": "sha256-of-session-file-path",
  "cwd": "/home/me/project",
  "created": "2026-06-23"
}
```

- **`stack`** (`"markdown"` | `"html"`) → which rendering pipeline (and runtime, validator, export targets) to use.
- **`entry`** → where to start rendering.
- **`sessionFile` / `sessionKey` / `cwd`** → provenance, populated when running under Pi (see Pi integration). `sessionFile` comes from Pi's session manager when available; `sessionKey` is a stable derived key used for filtering without depending on an undocumented `session_id`. Empty/omitted when used standalone.
- Plus metadata (`title`, `created`) for listing, lifecycle, and cleanup.
- _(A `vendored` list can be added only by the rare artifact that pulls in a library outside the shared runtime.)_

## Design decisions

- **Use the directory pattern uniformly**, even for currently-single-file artifacts. A Mermaid-only markdown artifact really is one file, but it may _grow_ an SVG asset later. Defaulting everything to the directory structure means it can gain assets without restructuring, and tooling stays simple — always `<id>/<entry>`, no special cases.
- **Keep assets in an `assets/` subfolder**, not flat. Keeps the entry point obvious and the directory scannable.
- **Content-only bundles, shared runtime.** Resolve the "self-contained vs shared" question by context: **in the viewer**, artifacts reference the shared runtime (lighter bundles, richer capabilities, less for the agent to write); **on export**, everything used is inlined into a standalone file. So isolation holds where it matters — the artifact's own _content_ and the _exported_ file are self-contained — while the _capability layer_ is shared infrastructure. The store stays isolated per-artifact; only the runtime is shared.

---

# Pi integration

Target host: the **Pi coding agent** — a minimal terminal (TUI) harness, extended via TypeScript packages installed with `pi install npm:<pkg>`. Two of its properties shape the integration: it can't render HTML inline (so visuals need an external surface), and extensions are factory functions that subscribe to session events and register tools/commands (which is what makes a _session-reactive_ viewer possible).

## Packaging as a Pi extension

The system ships as a Pi extension — a default factory `export default function (pi: ExtensionAPI)` — that registers:

- **Tools** the agent calls: `scaffold_artifact` (create an empty bundle) and `render_artifact` (validate + surface it in the viewer).
- A **command** (e.g. `/viewer`) to launch the viewer surface.
- **Session-event subscriptions** (`session_start`, and replacement flows such as `/resume`) that eventually drive live updates.
- Terminal feedback via `ctx.ui.notify` / `ctx.ui.setStatus`.

Node built-ins (`node:fs`, `node:path`, `child_process`) cover storage and export with no dependencies. The viewer likely takes **one deliberate dependency** — a webview runtime — for its bidirectional channel, but the concrete viewer primitive is an early spike rather than a settled implementation detail. Config lives in `~/.pi/agent/settings.json`.

### The tool interface

Two agent-facing tools, split to match Pi's nature as a file-editing coding agent — scaffold creates the empty bundle, the agent authors into it with its normal file tools, then render validates and surfaces it:

```
scaffold_artifact({ type, title })
  → creates ~/.pi/artifacts/<id>/ : manifest + blank entry + assets/
  → returns { id, path, entry }          (no content written)

render_artifact({ id })
  → runs the validation gate on the authored bundle
  → on pass: viewer renders / updates it, scoped to the session
  → returns { ok, warnings[], errors[] } (feedback the agent can act on)
```

The flow: `scaffold_artifact` → agent writes content into the blank entry → `render_artifact`. Because the agent edits real files, there's no content blob to pass and no template to mimic — it composes freely.

**Iteration is re-render in place.** To refine, the agent edits the same entry file and calls `render_artifact({ id })` again — the bundle is re-validated and the viewer re-renders the _same_ artifact. A new artifact means a new `scaffold_artifact` call. So the generate→refine loop evolves one artifact rather than spawning near-duplicates.

## Storage location: global and session-aware

Pi centralizes its state under `~/.pi/`, so the artifact store lives there too — global, not per-project: `~/.pi/artifacts/<artifact-id>/`. This global store is the **source of truth**: one place to browse every artifact across all projects, with natural dedup. The manifest's provenance fields make global storage still feel local:

- **`sessionKey`** is the **live join key** — the viewer filters to the active session's artifacts and re-renders when the session changes. It should be derived from the Pi session file path exposed by `ctx.sessionManager.getSessionFile()` rather than assuming an undocumented built-in session id.
- **`sessionFile`** is retained as provenance/debug metadata when available.
- **`cwd`** ties an artifact to the project that made it without scattering files into every repo.
- **Optional local access** — an opt-in pointer (`./.pi-artifacts → ~/.pi/artifacts`) gives relative-path access from the running project. Symlinks are awkward on Windows, so this is sugar, not the foundation.

## Rendering surface: a unified, session-reactive viewer

A TUI can't render HTML, so artifacts need an external rendering surface. The target experience is a **persistent, session-reactive viewer** — one companion launched by `/viewer`, showing the current session's artifacts and updating as renders/session switches happen. However, persistence across Pi session replacement (`/resume`, `/new`, `/fork`) is a lifecycle-sensitive feature: Pi tears down and rebinds extension instances during those flows, so the first implementation should not assume a long-lived window survives correctly until that behavior is verified.

It's a **unified gallery**, not a per-artifact popup: a list of every artifact in the active session on one side, the selected artifact rendered in the main pane on the other, with export controls. Crucially, the gallery is **type-agnostic** — it renders markdown artifacts through the markdown-it pipeline and html artifacts directly, both ending up as HTML in the same surface. So you switch between _any_ artifact type instantly in one place, and the same surface absorbs new types as they're added.

The preferred direction is still a bidirectional webview because the core requirement is **push, not pull**: Pi should be able to push viewer updates when state changes. But the viewer runtime is an early technical spike, not a foregone conclusion. Compare a Pi/native webview package, a general webview binding, and a small local server plus browser with WebSocket/SSE. If the server/browser route is simpler and reliable enough, it may be a better MVP path even if the final target remains a webview.

### The live-sync model

```
  Pi (TUI)                            Webview companion
  ────────                            ─────────────────
  /viewer ──────────────────────────► window opens
  session A active ──push list──────► shows A's artifacts
  /resume → session B
  (session-replacement event) ──────► shows B's artifacts   (auto-updated)
  agent renders new artifact ───────► list gains the item   (live)
  user clicks an artifact ◄────────── opens it / sends an action back to the agent
```

1. `/viewer` launches the surface. MVP may relaunch/reconnect manually; the target is one companion that persists for the run.
2. On `session_start` / session-replacement, the handler computes the active `sessionKey`, queries the store for matching artifacts, and **pushes the filtered list** into the viewer.
3. Once persistence is proven, the window re-renders — no relaunch, no manual refresh. Switch session in the terminal, the companion follows.
4. The channel is bidirectional: a click can **send an action back to the agent** (e.g. expand a node → ask the agent to elaborate), which display-only surfaces can't do.

A direct file open (`open` / `xdg-open` / `start` over `file://`) can remain as an optional fallback for simple static bundles, but the MVP preview path should use a tiny local server from day one. That avoids `file://` restrictions around `fetch("assets/data.json")`, better matches the eventual viewer architecture, and gives a clear place to enforce local-only/offline access.

## Export: a viewer capability, any supported format

Export is built into the viewer, not a separate step: select any artifact and export it to a supported format. The working form stays multi-file (clean, editable, isolated); export produces the shareable single file.

The format set is per-type and **extensible**, same as the type set:

- **markdown → standalone `.html`, PDF**, or a single `.md` with embedded/base64 assets.
- **html → one inlined `.html`** — inline CSS/JS, base64 images/SVG → opens anywhere.
- New types register their own export targets; the viewer's export control just offers whatever formats the selected artifact's renderer declares.

---

# Data injection

Visualizations often need real data — e.g. a stock chart pulling live prices. Two distinct problems hide here: **snapshot** data (fetch once, bake in) and **live** data (keep updating). They have very different architectural fits.

## Snapshot data — supported now

The default pattern: **the agent fetches at author time** and writes the result into the bundle. The agent calls the data source (its existing capability), saves to `assets/data.json`, and the artifact reads that local file (e.g. a chart spec with `"data": { "url": "assets/data.json" }`).

This fits the model cleanly: the bundle stays self-contained, the validation gate can check the data, it exports cleanly (data inlines), and it works offline forever after. The cost is that it's a snapshot frozen at creation.

The alternative — the artifact fetching at render time — is possible but breaks self-containment, export, and the security posture (artifact reaching the network), so **agent-fetch-to-`assets/` is the recommended default.**

## Live / real-time data — a deliberate open question

Real-time updating breaks a foundational assumption: artifacts are currently **static snapshots** that re-render only when the agent calls `render_artifact` again. Nothing yet pushes new data into an already-open artifact. Three ways to close that, ordered by how much they disturb the design:

- **A — Agent-driven refresh.** Artifact stays static; the agent re-fetches and re-renders on a timer/trigger via the existing re-render-in-place loop. Polled and coarse, burns agent turns — fine for "every few minutes," wrong for a ticking price.
- **B — Artifact self-polls.** `index.html` runs `setInterval` to re-fetch and update itself; Alpine handles the reactive update. Contradicts self-containment, export, and security (outbound calls from the artifact).
- **C — Viewer-brokered live channel (front-runner).** The artifact doesn't fetch; the **viewer** holds the data connection and pushes updates into the artifact over the _same bidirectional channel built for session-sync_. Reuses existing plumbing, centralizes network access in the viewer (better security), keeps bundles content-only; the artifact declares "feed X" and reacts to pushes. Cost: a data-broker layer + subscription contract in the viewer.

Option C is the front-runner because it matches the real-time ambition _and_ harmonizes with the architecture — live data becomes the push channel's **second use case**, after session-sync. It's a genuine scope addition, not a refinement, so it's parked as direction rather than built.

> [!NOTE]
> Worth naming so it doesn't calcify: **"artifacts are static" is an assumption, not a law.** Live data is the capability that breaks it, and it was part of the original vision — so the architecture should stay open to it (Option C reuses the channel that already exists).

---

# End-to-end example

A concrete pass through the whole loop, to ground the pieces — the agent builds a small interactive dashboard.

**1. Decide the type.** The output is something to _operate_ (filter, toggle), not just read → `html`.

**2. Scaffold.** The agent calls `scaffold_artifact({ type: "html", title: "Q4 Revenue" })`. The extension creates:

```
~/.pi/artifacts/q4-revenue/
  manifest.json        (stack: "html", entry: "index.html", sessionKey/sessionFile, cwd…)
  index.html           (blank)
  assets/
```

**3. Author into the blank entry.** Using its normal file tools, the agent writes _just content_ — semantic HTML for structure, an Alpine directive for interactivity, a chart spec. No `<!doctype>`, no `<head>`, no `<script>` tags, no CSS:

```html
<main>
  <h1>Q4 Revenue</h1>
  <section x-data="{ region: 'all' }">
    <nav>
      <button @click="region = 'all'">All</button>
      <button @click="region = 'emea'">EMEA</button>
      <button @click="region = 'apac'">APAC</button>
    </nav>
    <p>Showing: <strong x-text="region"></strong></p>
    <div
      data-chart='{
      "mark": "bar",
      "data": { "url": "assets/revenue.json" },
      "encoding": {
        "x": { "field": "quarter", "type": "ordinal" },
        "y": { "field": "amount", "type": "quantitative" }
      }
    }'
    ></div>
  </section>
</main>
```

The semantic tags get styled by the shared CSS base; `x-data`/`@click`/`x-text` work because the viewer injects Alpine; `data-chart` is picked up by the injected charting lib. The agent wrote intent, nothing else.

**4. Render.** The agent calls `render_artifact({ id: "q4-revenue" })`. The validation gate runs (Prettier tidies formatting; HTMLHint confirms well-formed markup; the runtime-check confirms `data-chart` and the Alpine directives map to provided capabilities). On pass, the viewer — already open and scoped to this session — adds the artifact to its list and renders it.

**5. Refine in place.** The user asks for a line chart instead. The agent edits `index.html`, calls `render_artifact({ id: "q4-revenue" })` again — same `id`, so the viewer re-renders the _same_ artifact. No duplicate.

**6. Export (optional).** From the viewer, export → one inlined `.html`: the CSS base, Alpine, the chart lib, and `revenue.json` are all inlined/base64'd into a single file that opens in any browser, detached from the runtime.

The throughline: the agent touched only `index.html`'s content and two tool calls. Structure, styling, interactivity engine, charting, validation, rendering, and session-scoping were all supplied by the system.

A build order that gets a usable surface early, then layers on reactive and export features.

## Components

| Component                    | Responsibility                                                                                                                                   | Depends on                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| **Markdown renderer**        | markdown-it pipeline + Mermaid/KaTeX (shared, in the viewer)                                                                                     | —                                 |
| **html runtime**             | Shared generated-UI kit: semantic CSS base, Alpine, charting lib, icons (installed, served by viewer)                                            | —                                 |
| **Authoring guide**          | Pi skill telling the agent how to use the html runtime — the enabler that makes it low-effort                                                    | html runtime                      |
| **Bundle store**             | Read/write `~/.pi/artifacts/<id>/`, manifests with `sessionKey`/`sessionFile`/`cwd`                                                              | `node:fs`, `node:path`            |
| **`scaffold_artifact` tool** | Agent-callable: create empty bundle (manifest + blank entry + `assets/`), return `{id, path, entry}`                                             | Scaffolds, store                  |
| **`render_artifact` tool**   | Agent-callable: validate the authored bundle → render/update in viewer (same `id` = in place) → return feedback                                  | renderers, store, validation gate |
| **Validation gate**          | format → lint → parse-check during `render_artifact`; autofix / warn / error, feedback to the agent                                              | renderers, registry               |
| **Scaffolds**                | Per-type empty-bundle spec; one per type, no content                                                                                             | renderers                         |
| **Renderer registry**        | Maps each `stack` value to a renderer, validator, + export targets — the extension point for new types                                           | —                                 |
| **Unified viewer**           | External surface: session-scoped list, renders any type via the registry, export controls; persistent window is the target after lifecycle spike | viewer runtime, store, registry   |
| **Session sync**             | Subscribe to `session_start` / replacement → compute `sessionKey` → push filtered list                                                           | Viewer, store                     |
| **Export**                   | Inline shared runtime + content into a format the renderer declares                                                                              | Store, registry                   |

## Phases

> The MVP (Phase 1) is split **markdown-first**, then **html**, to derisk everything structural before the heavier shared-runtime-injection work. See the [roadmap](../roadmap.md) for the authoritative, sequenced build order.

1. **MVP-1 — markdown-only core loop (no full UI).** Stand up the markdown renderer plus its authoring guide; implement the bundle store, `scaffold_artifact`, and `render_artifact` with the validation gate (Prettier autofix + markdownlint + KaTeX strict; Mermaid parse-check gated behind the headless-Node feasibility spike, warn-only/skipped if it can't run; custom tier-check as a fast-follow). Verify content-only markdown bundles land in `~/.pi/artifacts/` with correct manifests, validated and rendered. Serve previews through a tiny localhost server from day one — scoped to the selected artifact directory plus package runtime files, with a baseline restrictive CSP — which avoids `file://` asset-fetch limitations and starts the security boundary early. Proves the core loop without full viewer work or any html-runtime weight.
2. **MVP-2 — html stack.** Add the shared html runtime (CSS base, Alpine, charts, icons) injected at render time, its authoring guide, and the html validation gate (Prettier + HTMLHint + runtime-check). Confirm the baseline CSP holds for runtime-injected JS. Brings up the dynamic-UI lane on the proven core loop.
3. **Static viewer.** Add the `/viewer` surface showing the full artifact list and rendering a selected bundle via the renderer registry. No live sync yet — manual refresh is fine. Confirms the chosen viewer runtime, window/process lifecycle, and registry-driven rendering of both types.
4. **Session sync.** Wire `session_start` / session-replacement events to compute the active `sessionKey` and push the filtered list into the open viewer. Delivers the reactive behavior: switch session → list updates.
5. **Bidirectional actions.** Add the window→agent channel so a click sends an action back (open, expand, regenerate). Turns the viewer from display-only into interactive. _(Has real design uncertainty — define the action protocol here, don't assume it's just wiring.)_
6. **Export.** Add single-file export (inlined HTML first, then PDF / md).

## Open decisions

- **Viewer runtime choice** — spike the available options before committing: a Pi/native webview package if one exists, a general binding (e.g. Tauri / a `webview` lib), or local server + browser + WebSocket/SSE. Trades integration depth, footprint, install friction, and cross-platform behavior.
- **Window/process lifecycle** — re-open cleanly if the user closes it; tear down on Pi exit. Persistent across sessions is the target, but Pi session replacement tears down/rebinds extension instances, so first prove whether a singleton companion can survive `/resume`, `/new`, and `/fork` safely. Fall back to session-scoped/manual relaunch for MVP if needed.
- **Session identity** — use Pi-exposed session state, likely `ctx.sessionManager.getSessionFile()`, and derive `sessionKey` from it. Avoid depending on an undocumented `session_id` until the API/source confirms one exists.
- **Pin the Pi extension API** against current docs — `registerTool` parameter shape and exact session-lifecycle event names are evolving; verify before coding.
- **Shared-runtime versioning** — pin the curated runtime (CSS base, Alpine, charts, icons) and refresh deliberately; one version serves all artifacts, so a bump re-renders existing ones. The rare per-artifact vendored library (the escape hatch) is pinned within that bundle.
- **MVP preview transport** — use a tiny local preview server from day one. It should serve only the selected artifact directory and package runtime files, reject path traversal, bind to localhost, and avoid any external-network proxying by default.
- **Lifecycle / cleanup** — the global store grows unbounded. Decide retention: keep-forever with a manual `/artifacts clear`, age-based eviction, or per-session pruning on session end. `created` (and a possible `last_rendered`) in the manifest support whatever policy is chosen.
- **Trust / security** — html artifacts execute agent-generated markup/JS in the viewer. This sits near the same trust model as a coding agent that already runs code, but the posture should be explicit before the viewer is built: render artifacts in a sandboxed iframe or equivalent isolation, avoid Node integration in rendered content, set a restrictive CSP, scope file access to the artifact directory, keep artifacts offline/local-only by default, define how per-artifact vendored JS is reviewed/loaded, and inherit Pi's project-trust gating before auto-rendering untrusted bundles. **A baseline restrictive CSP is not deferred — it ships in Phase 1 (MVP-1's preview server) since a browser surface exists from day one; full sandboxing/iframe isolation and the rest of this posture stay deferred until the viewer is built.**
- **Live data** — snapshot data works today (agent fetches → `assets/`). Real-time updating needs a new capability: Option C (viewer-brokered push over the session-sync channel) is the front-runner, with A/B as simpler fallbacks. It pressures self-containment, export, and security. Parked until needed — see Data injection.
