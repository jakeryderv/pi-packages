import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import prettier from "prettier";

import type { RenderArtifactDetails, ValidationFinding } from "../types.ts";

const require = createRequire(import.meta.url);

interface HtmlHintMessage {
  rule: { id: string };
  line: number;
  col: number;
  message: string;
  type: "error" | "warning" | "info";
}

interface HtmlHintLike {
  verify(html: string, ruleset?: Record<string, unknown>): HtmlHintMessage[];
}

const { HTMLHint } = require("htmlhint") as { HTMLHint: HtmlHintLike };

const SUPPORTED_COMPONENTS = new Set([
  "pi-data-source",
  "pi-grid",
  "pi-card",
  "pi-metric",
  "pi-chart",
  "pi-table",
]);

/**
 * html validation gate (Phase C, Pass 2).
 *
 * Mirrors the markdown gate: format -> lint -> capability-check.
 *   - Prettier formats `index.html` in place (autofix; warn on parse failure).
 *   - HTMLHint findings are warnings (structural correctness, not style).
 *   - Runtime-capability checks warn when authored markup uses features that
 *     are blocked by the strict CSP (inline <script>, on* handlers,
 *     javascript: URLs) or that won't render (a chart <canvas> with no spec).
 *
 * Nothing here is render-blocking: authored html is served under the baseline
 * CSP regardless, so the gate is advisory. (Math/KaTeX is markdown-only.)
 */
export async function validateHtmlArtifact(
  entryPath: string,
): Promise<Pick<RenderArtifactDetails, "warnings" | "errors">> {
  const warnings: ValidationFinding[] = [];
  const errors: ValidationFinding[] = [];

  const original = await readFile(entryPath, "utf8");
  const formatted = await formatHtml(original, entryPath, warnings);
  if (formatted !== original) {
    await writeFile(entryPath, formatted);
  }

  warnings.push(...lintHtml(formatted, entryPath));
  warnings.push(...findCspWarnings(formatted, entryPath));
  warnings.push(...findChartWarnings(formatted, entryPath));
  warnings.push(...findComponentWarnings(formatted, entryPath));

  return { warnings, errors };
}

async function formatHtml(
  html: string,
  entryPath: string,
  warnings: ValidationFinding[],
): Promise<string> {
  try {
    return await prettier.format(html, { filepath: entryPath, parser: "html" });
  } catch (error) {
    warnings.push({
      code: "prettier",
      message: `Prettier could not format html: ${messageFromError(error)}`,
      file: entryPath,
    });
    return html;
  }
}

function lintHtml(html: string, entryPath: string): ValidationFinding[] {
  const messages = HTMLHint.verify(html, {
    "tagname-lowercase": true,
    "attr-lowercase": true,
    "attr-value-double-quotes": true,
    "attr-no-duplication": true,
    "tag-pair": true,
    "spec-char-escape": true,
    "id-unique": true,
    "src-not-empty": true,
    "empty-tag-not-self-closed": true,
  });

  return messages.map((message) => ({
    code: `htmlhint/${message.rule.id}`,
    message: message.message,
    file: entryPath,
    line: message.line,
    column: message.col,
  }));
}

function findCspWarnings(html: string, entryPath: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  // Inline <script> with a body (not a data block) executes JS, which the
  // baseline CSP blocks. <script type="application/json"> is data and allowed.
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    const attrs = match[1] ?? "";
    const body = (match[2] ?? "").trim();
    const typeMatch = /type\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const type = typeMatch?.[1]?.toLowerCase();
    const isData =
      type === "application/json" || type === "application/ld+json";
    const hasSrc = /\bsrc\s*=/.test(attrs);
    if (hasSrc) {
      pushAt(findings, html, match.index, {
        code: "csp/script-src",
        message:
          "Authored <script src> files are not allowed in artifacts. Use the injected pi-artifacts runtime capabilities instead.",
        file: entryPath,
      });
    }
    if (!isData && !hasSrc && body.length > 0) {
      pushAt(findings, html, match.index, {
        code: "csp/inline-script",
        message:
          "Inline <script> executes JS and is blocked by the artifact CSP. Use the chart spec convention or an injected pi-artifacts runtime capability.",
        file: entryPath,
      });
    }
  }

  for (const match of html.matchAll(/\son[a-z]+\s*=\s*["']/gi)) {
    pushAt(findings, html, match.index, {
      code: "csp/inline-handler",
      message:
        "Inline event handlers (on*=) are blocked by the artifact CSP. Bind behavior from a runtime script served from /runtime, or use CSS-only interactivity.",
      file: entryPath,
    });
  }

  for (const match of html.matchAll(
    /(?:href|src)\s*=\s*["']\s*javascript:/gi,
  )) {
    pushAt(findings, html, match.index, {
      code: "csp/javascript-url",
      message:
        "URLs using the javascript scheme are blocked by the artifact CSP.",
      file: entryPath,
    });
  }

  return findings;
}

function findChartWarnings(
  html: string,
  entryPath: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  for (const match of html.matchAll(
    /<canvas\b[^>]*\bdata-chart\b[\s\S]*?<\/canvas>|<canvas\b[^>]*\bdata-chart\b[^>]*\/?>/gi,
  )) {
    const fragment = html.slice(match.index, match.index + 600);
    const hasSpec =
      /class\s*=\s*["'][^"']*\bpi-chart-spec\b/i.test(fragment) ||
      /type\s*=\s*["']application\/json["']/i.test(fragment);
    if (!hasSpec) {
      pushAt(findings, html, match.index, {
        code: "chart/missing-spec",
        message:
          'A <canvas data-chart> needs a sibling <script type="application/json" class="pi-chart-spec"> Chart.js config to render.',
        file: entryPath,
      });
    }
  }

  return findings;
}

function findComponentWarnings(
  html: string,
  entryPath: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const declaredFeeds = collectFeedDeclarations(html, entryPath, findings);
  findComponentUsageWarnings(html, entryPath, declaredFeeds, findings);
  return findings;
}

function collectFeedDeclarations(
  html: string,
  entryPath: string,
  findings: ValidationFinding[],
): Set<string> {
  const declaredFeeds = new Set<string>();
  for (const match of html.matchAll(/<pi-data-source\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const name = attributeValue(attrs, "name");
    const src = attributeValue(attrs, "src");
    if (!name || !src || !isArtifactAssetSource(src)) {
      pushAt(findings, html, match.index, {
        code: "feed/invalid-source",
        message:
          '<pi-data-source> requires a name and an artifact-local src beneath "assets/".',
        file: entryPath,
      });
      continue;
    }
    if (declaredFeeds.has(name)) {
      pushAt(findings, html, match.index, {
        code: "feed/duplicate-name",
        message: `Data feed "${name}" is declared more than once.`,
        file: entryPath,
      });
    }
    declaredFeeds.add(name);
  }
  return declaredFeeds;
}

function findComponentUsageWarnings(
  html: string,
  entryPath: string,
  declaredFeeds: Set<string>,
  findings: ValidationFinding[],
): void {
  for (const match of html.matchAll(/<(pi-[a-z0-9-]+)\b([^>]*)>/gi)) {
    const tag = (match[1] ?? "").toLowerCase();
    const attrs = match[2] ?? "";
    if (!SUPPORTED_COMPONENTS.has(tag)) {
      pushAt(findings, html, match.index, {
        code: "component/unknown",
        message: `Unknown pi-artifacts component <${tag}>.`,
        file: entryPath,
      });
      continue;
    }
    if (tag === "pi-data-source") {
      continue;
    }

    const feed = attributeValue(attrs, "data-feed");
    if (feed && !declaredFeeds.has(feed)) {
      pushAt(findings, html, match.index, {
        code: "feed/unknown",
        message: `Component references undeclared data feed "${feed}". Add <pi-data-source name="${feed}" src="assets/data.json">.`,
        file: entryPath,
      });
    }
    if (tag === "pi-chart" && !feed && !hasNestedChartSpec(html, match)) {
      pushAt(findings, html, match.index, {
        code: "chart/missing-spec",
        message:
          "<pi-chart> needs data-feed or a nested JSON chart spec to render.",
        file: entryPath,
      });
    }
  }
}

function hasNestedChartSpec(html: string, match: RegExpMatchArray): boolean {
  if (match.index === undefined) {
    return false;
  }
  const contentStart = match.index + match[0].length;
  const contentEnd = html.toLowerCase().indexOf("</pi-chart>", contentStart);
  if (contentEnd === -1) {
    return false;
  }
  const content = html.slice(contentStart, contentEnd);
  for (const script of content.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = script[1] ?? "";
    const type = attributeValue(attributes, "type")?.toLowerCase();
    const classes = (attributeValue(attributes, "class") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    if (type === "application/json" || classes.includes("pi-chart-spec")) {
      return true;
    }
  }
  return false;
}

function isArtifactAssetSource(source: string): boolean {
  return (
    /^assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/.test(source) &&
    !source.split("/").some((part) => part === "." || part === "..")
  );
}

function attributeValue(attributes: string, name: string): string | undefined {
  for (const match of attributes.matchAll(
    /([a-z][a-z0-9-]*)\s*=\s*["']([^"']+)["']/gi,
  )) {
    if ((match[1] ?? "").toLowerCase() === name) {
      return match[2];
    }
  }
  return undefined;
}

function pushAt(
  findings: ValidationFinding[],
  html: string,
  index: number | undefined,
  finding: Omit<ValidationFinding, "line">,
): void {
  findings.push({
    ...finding,
    line: index === undefined ? undefined : lineForIndex(html, index),
  });
}

function lineForIndex(value: string, index: number): number {
  return value.slice(0, index).split("\n").length;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
