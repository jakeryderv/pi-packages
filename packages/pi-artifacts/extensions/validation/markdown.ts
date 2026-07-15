import { readFile, writeFile } from "node:fs/promises";

import * as katex from "katex";
import { lint } from "markdownlint/promise";
import prettier from "prettier";

import type { RenderArtifactDetails, ValidationFinding } from "../types.ts";

export async function validateMarkdownArtifact(
  entryPath: string,
): Promise<Pick<RenderArtifactDetails, "warnings" | "errors">> {
  const warnings: ValidationFinding[] = [];
  const errors: ValidationFinding[] = [];

  const original = await readFile(entryPath, "utf8");
  const formatted = await formatMarkdown(original, entryPath, warnings);
  if (formatted !== original) {
    await writeFile(entryPath, formatted);
  }

  warnings.push(...(await lintMarkdown(formatted, entryPath)));
  warnings.push(...findPortabilityWarnings(formatted, entryPath));
  errors.push(...findKatexErrors(formatted, entryPath));

  return { warnings, errors };
}

async function formatMarkdown(
  markdown: string,
  entryPath: string,
  warnings: ValidationFinding[],
): Promise<string> {
  try {
    return await prettier.format(markdown, {
      filepath: entryPath,
      parser: "markdown",
    });
  } catch (error) {
    warnings.push({
      code: "prettier",
      message: `Prettier could not format markdown: ${messageFromError(error)}`,
      file: entryPath,
    });
    return markdown;
  }
}

async function lintMarkdown(
  markdown: string,
  entryPath: string,
): Promise<ValidationFinding[]> {
  const results = await lint({
    strings: { [entryPath]: markdown },
    config: {
      default: true,
      MD013: false,
    },
    resultVersion: 3,
  });

  return (results[entryPath] ?? []).map((error) => ({
    code: error.ruleNames[0] ?? "markdownlint",
    message: `${error.ruleDescription}${
      error.errorDetail ? `: ${error.errorDetail}` : ""
    }`,
    file: entryPath,
    line: error.lineNumber,
    column: error.errorRange?.[0],
  }));
}

function findKatexErrors(
  markdown: string,
  entryPath: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const scanText = stripFencedCodeBlocks(markdown);

  for (const match of scanText.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
    const expression = match[1];
    if (match.index === undefined || expression === undefined) {
      continue;
    }
    const line = lineForIndex(scanText, match.index);
    validateKatexExpression({
      expression: expression.trim(),
      displayMode: true,
      entryPath,
      line,
      findings,
    });
  }

  for (const match of scanText.matchAll(/(?<!\$)\$([^\n$]+?)\$(?!\$)/g)) {
    const expression = match[1];
    if (match.index === undefined || expression === undefined) {
      continue;
    }
    const line = lineForIndex(scanText, match.index);
    validateKatexExpression({
      expression: expression.trim(),
      displayMode: false,
      entryPath,
      line,
      findings,
    });
  }

  return findings;
}

function validateKatexExpression(input: {
  expression: string;
  displayMode: boolean;
  entryPath: string;
  line: number;
  findings: ValidationFinding[];
}): void {
  try {
    katex.renderToString(input.expression, {
      displayMode: input.displayMode,
      throwOnError: true,
      strict: "error",
    });
  } catch (error) {
    input.findings.push({
      code: "katex",
      message: `Invalid LaTeX math: ${messageFromError(error)}`,
      file: input.entryPath,
      line: input.line,
    });
  }
}

function findPortabilityWarnings(
  markdown: string,
  entryPath: string,
): ValidationFinding[] {
  const warnings: ValidationFinding[] = [];
  const scanText = stripFencedCodeBlocks(markdown);

  pushRegexWarnings({
    warnings,
    markdown: scanText,
    entryPath,
    regex: /!?\[\[[^\]]+\]\]/g,
    code: "portable-markdown/wikilink",
    message:
      "Wikilinks and Obsidian embeds are not portable; use standard Markdown links/images.",
  });

  pushRegexWarnings({
    warnings,
    markdown: scanText,
    entryPath,
    regex: /^[ \t]*\^[A-Za-z0-9_-]+[ \t]*$/gm,
    code: "portable-markdown/block-reference",
    message: "Obsidian block references are not portable Markdown.",
  });

  pushRegexWarnings({
    warnings,
    markdown: scanText,
    entryPath,
    regex: /<[A-Za-z][^>]*(?:\s(?:class|style)=)[^>]*>/g,
    code: "portable-markdown/raw-html-styling",
    message:
      "Raw HTML class/style attributes reduce portability across renderers.",
  });

  return warnings;
}

function pushRegexWarnings(input: {
  warnings: ValidationFinding[];
  markdown: string;
  entryPath: string;
  regex: RegExp;
  code: string;
  message: string;
}): void {
  for (const match of input.markdown.matchAll(input.regex)) {
    if (match.index === undefined) {
      continue;
    }
    input.warnings.push({
      code: input.code,
      message: input.message,
      file: input.entryPath,
      line: lineForIndex(input.markdown, match.index),
    });
  }
}

function stripFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split(/(\r?\n)/);
  let inFence = false;
  let fenceMarker: "```" | "~~~" | undefined;

  return lines
    .map((segment) => {
      if (segment === "\n" || segment === "\r\n") {
        return segment;
      }

      const trimmed = segment.trimStart();
      if (
        !inFence &&
        (trimmed.startsWith("```") || trimmed.startsWith("~~~"))
      ) {
        inFence = true;
        fenceMarker = trimmed.startsWith("```") ? "```" : "~~~";
        return "";
      }

      if (inFence) {
        if (fenceMarker && trimmed.startsWith(fenceMarker)) {
          inFence = false;
          fenceMarker = undefined;
        }
        return "";
      }

      return segment;
    })
    .join("");
}

function lineForIndex(value: string, index: number): number {
  return value.slice(0, index).split("\n").length;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
