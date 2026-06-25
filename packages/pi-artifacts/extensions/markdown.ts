import { createRequire } from "node:module";

import * as katex from "katex";

const require = createRequire(import.meta.url);

type MarkdownItRenderer = {
  render: (source: string) => string;
};

interface MdToken {
  type: string;
  content: string;
  children: MdToken[] | null;
  attrJoin(name: string, value: string): void;
}

interface MdState {
  tokens: MdToken[];
  Token: new (type: string, tag: string, nesting: number) => MdToken;
}

interface MarkdownItInstance extends MarkdownItRenderer {
  core: {
    ruler: {
      after(after: string, name: string, fn: (state: MdState) => void): void;
    };
  };
}

type MarkdownItConstructor = new (options?: {
  html?: boolean;
  linkify?: boolean;
  typographer?: boolean;
}) => MarkdownItInstance;

const MarkdownIt = require("markdown-it") as MarkdownItConstructor;

const markdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

const ALERT_TYPES = new Set(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]);

markdownIt.core.ruler.after("inline", "pi-task-lists", taskListsRule);
markdownIt.core.ruler.after("block", "pi-alerts", alertsRule);

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

export function renderMarkdownPage(markdown: string, title: string): string {
  const body = renderMarkdownBody(markdown);
  const escapedTitle = escapeHtml(title);

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
</style>
<link rel="stylesheet" href="/runtime/katex.min.css">
</head>
<body>
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
