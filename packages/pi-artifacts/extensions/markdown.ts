import { createRequire } from "node:module";

import * as katex from "katex";

import { RUNTIME_URLS } from "./runtime.ts";
import {
  artifactChromeStyles,
  renderArtifactToolbar,
  type ArtifactPageChrome,
} from "./viewer-ui.ts";

const require = createRequire(import.meta.url);

type MarkdownItRenderer = {
  render: (source: string) => string;
};

interface MdToken {
  type: string;
  info: string;
  content: string;
  children: MdToken[] | null;
  attrJoin(name: string, value: string): void;
}

interface MdState {
  tokens: MdToken[];
  Token: new (type: string, tag: string, nesting: number) => MdToken;
}

type MdRule = (
  tokens: MdToken[],
  index: number,
  options: unknown,
  env: unknown,
  self: unknown,
) => string;

interface MarkdownItInstance extends MarkdownItRenderer {
  core: {
    ruler: {
      after(after: string, name: string, fn: (state: MdState) => void): void;
    };
  };
  renderer: {
    rules: { fence?: MdRule };
  };
  use(plugin: (md: MarkdownItInstance) => void): MarkdownItInstance;
}

type MarkdownItConstructor = new (options?: {
  html?: boolean;
  linkify?: boolean;
  typographer?: boolean;
  highlight?: (code: string, lang: string) => string;
}) => MarkdownItInstance;

interface HighlightJsLike {
  getLanguage(name: string): unknown;
  highlight(
    code: string,
    options: { language: string; ignoreIllegals?: boolean },
  ): { value: string };
}

const MarkdownIt = require("markdown-it") as MarkdownItConstructor;
// `lib/common` bundles the ~40 common grammars instead of all ~190.
const hljsModule = require("highlight.js/lib/common") as
  | HighlightJsLike
  | { default: HighlightJsLike };
const hljs = "default" in hljsModule ? hljsModule.default : hljsModule;
const footnotePlugin = require("markdown-it-footnote") as (
  md: MarkdownItInstance,
) => void;

const markdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  // Highlighting happens server-side; the page only needs theme CSS. A full
  // `<pre class="hljs">` return is used verbatim by markdown-it, and unknown
  // languages fall back to the default escaped <pre><code> rendering.
  highlight: (code, lang) => {
    if (!lang || !hljs.getLanguage(lang)) {
      return "";
    }
    const highlighted = hljs.highlight(code, {
      language: lang,
      ignoreIllegals: true,
    }).value;
    return `<pre class="hljs"><code class="language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
  },
});

markdownIt.use(footnotePlugin);

const ALERT_TYPES = new Set(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]);

markdownIt.core.ruler.after("inline", "pi-task-lists", taskListsRule);
markdownIt.core.ruler.after("block", "pi-alerts", alertsRule);

// ```mermaid fences become <pre class="mermaid"> blocks that the injected
// mermaid runtime hydrates client-side; every other fence keeps the default
// <pre><code> rendering.
const defaultFenceRule = markdownIt.renderer.rules.fence;
markdownIt.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token?.info.trim() === "mermaid") {
    return `<pre class="mermaid">${escapeHtml(token.content)}</pre>\n`;
  }
  return defaultFenceRule
    ? defaultFenceRule(tokens, index, options, env, self)
    : "";
};

function taskListsRule(state: MdState): void {
  const tokens = state.tokens;

  for (let i = 2; i < tokens.length; i += 1) {
    const inline = tokens[i];
    if (
      !inline ||
      inline.type !== "inline" ||
      tokens[i - 1]?.type !== "paragraph_open" ||
      tokens[i - 2]?.type !== "list_item_open"
    ) {
      continue;
    }

    const firstChild = inline.children?.[0];
    if (!firstChild || firstChild.type !== "text") {
      continue;
    }

    const match = /^\[([ xX])\]\s+/.exec(firstChild.content);
    if (!match) {
      continue;
    }

    const checked = match[1] !== " ";
    firstChild.content = firstChild.content.slice(match[0].length);

    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input class="task-list-item-checkbox" disabled type="checkbox"${
      checked ? " checked" : ""
    }> `;
    inline.children?.unshift(checkbox);

    tokens[i - 2]?.attrJoin("class", "task-list-item");
  }
}

function alertsRule(state: MdState): void {
  const tokens = state.tokens;

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.type !== "blockquote_open") {
      continue;
    }

    const inline = tokens[i + 2];
    if (
      tokens[i + 1]?.type !== "paragraph_open" ||
      !inline ||
      inline.type !== "inline"
    ) {
      continue;
    }

    const match = /^\[!([A-Za-z]+)\]/.exec(inline.content);
    const type = match?.[1]?.toUpperCase();
    if (!type || !ALERT_TYPES.has(type)) {
      continue;
    }

    const blockquote = tokens[i];
    blockquote?.attrJoin("class", `pi-alert pi-alert-${type.toLowerCase()}`);

    const children = inline.children ?? [];
    if (children[0] && /^\[!/.test(children[0].content)) {
      children.shift();
      if (children[0]?.type === "softbreak") {
        children.shift();
      }
    }
    inline.content = inline.content.replace(/^\[![A-Za-z]+\]\s*/, "");

    const title = new state.Token("html_block", "", 0);
    title.content = `<p class="pi-alert-title">${formatAlertTitle(type)}</p>\n`;
    tokens.splice(i + 1, 0, title);
  }
}

function formatAlertTitle(type: string): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

interface MathReplacement {
  placeholder: string;
  html: string;
  block: boolean;
}

export function renderMarkdownPage(
  markdown: string,
  title: string,
  artifact?: string | ArtifactPageChrome,
): string {
  const body = renderMarkdownBody(markdown);
  const escapedTitle = escapeHtml(title);
  const artifactId = typeof artifact === "string" ? artifact : artifact?.id;
  const toolbar =
    typeof artifact === "object" ? renderArtifactToolbar(artifact) : "";
  const liveReload = artifactId
    ? `<script src="/runtime/pi/viewer-live.js" data-artifact-id="${escapeHtml(artifactId)}" defer></script>\n`
    : "";
  // The mermaid bundle is multi-megabyte; only documents that actually
  // contain a diagram pay for it.
  const mermaidRuntime = body.includes('<pre class="mermaid">')
    ? `<script src="${RUNTIME_URLS.mermaidJs}" defer></script>\n<script src="${RUNTIME_URLS.mermaidInitJs}" defer></script>\n`
    : "";
  // Theme CSS only when something was actually highlighted.
  const hljsCss = body.includes('<pre class="hljs">')
    ? `<link rel="stylesheet" href="${RUNTIME_URLS.hljsCssLight}" media="(prefers-color-scheme: light)">\n<link rel="stylesheet" href="${RUNTIME_URLS.hljsCssDark}" media="(prefers-color-scheme: dark)">\n`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle}</title>
<style>
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { max-width: 72rem; margin: 0 auto; padding: 2rem; line-height: 1.6; }
img { max-width: 100%; height: auto; }
pre { overflow-x: auto; padding: 1rem; border-radius: 0.5rem; background: color-mix(in srgb, CanvasText 8%, Canvas); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid color-mix(in srgb, CanvasText 25%, Canvas); padding: 0.35rem 0.5rem; }
blockquote { border-left: 0.25rem solid color-mix(in srgb, CanvasText 25%, Canvas); margin-left: 0; padding-left: 1rem; color: color-mix(in srgb, CanvasText 78%, Canvas); }
.task-list-item { list-style-type: none; }
.task-list-item-checkbox { margin: 0 0.4em 0 -1.4em; }
.pi-alert { border-left: 0.25rem solid var(--pi-alert-color, color-mix(in srgb, CanvasText 25%, Canvas)); padding: 0.25rem 1rem; color: inherit; }
.pi-alert-title { font-weight: 700; margin: 0 0 0.4rem; color: var(--pi-alert-color); }
.pi-alert-note { --pi-alert-color: #2563eb; }
.pi-alert-tip { --pi-alert-color: #16a34a; }
.pi-alert-important { --pi-alert-color: #9333ea; }
.pi-alert-warning { --pi-alert-color: #d97706; }
.pi-alert-caution { --pi-alert-color: #dc2626; }
.katex-display { overflow-x: auto; overflow-y: hidden; }
${artifactChromeStyles()}
</style>
<link rel="stylesheet" href="/runtime/katex/katex.min.css">
${hljsCss}${mermaidRuntime}${liveReload}</head>
<body>
${toolbar}
${body}
</body>
</html>
`;
}

function renderMarkdownBody(markdown: string): string {
  const replacements: MathReplacement[] = [];
  const markdownWithPlaceholders = replaceMath(markdown, replacements);
  let html = markdownIt.render(markdownWithPlaceholders);

  for (const replacement of replacements) {
    if (replacement.block) {
      html = html.replace(
        `<p>${replacement.placeholder}</p>`,
        replacement.html,
      );
    }
    html = html.replaceAll(replacement.placeholder, replacement.html);
  }

  return html;
}

function replaceMath(
  markdown: string,
  replacements: MathReplacement[],
): string {
  let output = "";
  let cursor = 0;
  const displayMath = /\$\$([\s\S]+?)\$\$/g;

  for (const match of markdown.matchAll(displayMath)) {
    const matchText = match[0];
    const expression = match[1];
    if (match.index === undefined || expression === undefined) {
      continue;
    }

    output += markdown.slice(cursor, match.index);
    const placeholder = `@@PI_ARTIFACT_MATH_BLOCK_${replacements.length}@@`;
    replacements.push({
      placeholder,
      html: katex.renderToString(expression.trim(), {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
      }),
      block: true,
    });
    output += placeholder;
    cursor = match.index + matchText.length;
  }

  output += markdown.slice(cursor);

  return output.replace(
    /(?<!\$)\$([^\n$]+?)\$(?!\$)/g,
    (_match, expression: string) => {
      const placeholder = `@@PI_ARTIFACT_MATH_INLINE_${replacements.length}@@`;
      replacements.push({
        placeholder,
        html: katex.renderToString(expression.trim(), {
          displayMode: false,
          throwOnError: false,
          strict: "ignore",
        }),
        block: false,
      });
      return placeholder;
    },
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
