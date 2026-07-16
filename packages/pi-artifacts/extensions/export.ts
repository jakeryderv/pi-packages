import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import { isPathInside } from "./path-safety.ts";
import { getArtifactRenderer } from "./renderer-registry.ts";
import { RUNTIME_ROOTS, RUNTIME_URLS } from "./runtime.ts";
import type { ArtifactManifest } from "./types.ts";

export interface ExportableArtifact {
  id: string;
  path: string;
  entryPath: string;
  manifest: ArtifactManifest;
}

export interface WrittenArtifactExport {
  path: string;
  bytes: number;
}

const CSS_RUNTIME_URLS = [
  RUNTIME_URLS.katexCss,
  RUNTIME_URLS.picoCss,
  RUNTIME_URLS.hljsCssLight,
  RUNTIME_URLS.hljsCssDark,
] as const;

const SCRIPT_RUNTIME_URLS = [
  RUNTIME_URLS.chartJs,
  RUNTIME_URLS.chartHydrateJs,
  RUNTIME_URLS.artifactComponentsJs,
  RUNTIME_URLS.mermaidJs,
  RUNTIME_URLS.mermaidInitJs,
] as const;

/** Render a portable HTML document containing no external runtime or bundle files. */
export async function renderArtifactExport(
  artifact: ExportableArtifact,
): Promise<string> {
  const source = await readFile(artifact.entryPath, "utf8");
  const renderer = getArtifactRenderer(artifact.manifest.stack);
  const nonce = randomBytes(24).toString("base64");
  let html = renderer.render(source, artifact.manifest.title);

  html = await inlineDataSources(html, artifact.path);
  html = await inlineRuntimeStyles(html);
  html = await inlineRuntimeScripts(html, nonce);
  html = stripAuthoredExecution(html, nonce);
  html = await inlineIconSprite(html);
  html = await inlineArtifactReferences(html, artifact.path);
  html = injectExportCsp(html, nonce);

  return html.endsWith("\n") ? html : `${html}\n`;
}

/** Write the deterministic export path inside the artifact bundle. */
export async function writeArtifactExport(
  artifact: ExportableArtifact,
): Promise<WrittenArtifactExport> {
  const html = await renderArtifactExport(artifact);
  const exportsDir = join(artifact.path, "exports");
  await mkdir(exportsDir, { recursive: true });

  const [realBundle, realExports] = await Promise.all([
    realpath(artifact.path),
    realpath(exportsDir),
  ]);
  if (!isPathInside(realBundle, realExports)) {
    throw new Error("Artifact export directory escapes its bundle.");
  }

  const outputPath = join(realExports, `${artifact.id}.html`);
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, html, { flag: "wx" });
    await rename(tempPath, outputPath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }

  return { path: outputPath, bytes: Buffer.byteLength(html) };
}

async function inlineRuntimeStyles(html: string): Promise<string> {
  let output = html;
  for (const url of CSS_RUNTIME_URLS) {
    const pattern = new RegExp(
      `<link\\b[^>]*\\bhref\\s*=\\s*(["'])${escapeRegex(url)}\\1[^>]*>`,
      "gi",
    );
    output = await replaceAsync(output, pattern, async (match) => {
      const tag = match[0];
      const media = attributeValue(tag, "media");
      const filePath = runtimeFilePath(url);
      const css = await inlineCssDependencies(
        await readFile(filePath, "utf8"),
        filePath,
        runtimeRootForUrl(url),
      );
      return `<style data-pi-runtime="${escapeHtml(url)}"${
        media ? ` media="${escapeHtml(media)}"` : ""
      }>\n${escapeStyleEnd(css)}\n</style>`;
    });
  }
  return output;
}

async function inlineRuntimeScripts(
  html: string,
  nonce: string,
): Promise<string> {
  let output = html;
  for (const url of SCRIPT_RUNTIME_URLS) {
    const pattern = new RegExp(
      `<script\\b[^>]*\\bsrc\\s*=\\s*(["'])${escapeRegex(url)}\\1[^>]*>\\s*</script>`,
      "gi",
    );
    output = await replaceAsync(output, pattern, async () => {
      const source = await readFile(runtimeFilePath(url), "utf8");
      return `<script nonce="${nonce}" data-pi-runtime="${escapeHtml(url)}">\n${escapeScriptEnd(source)}\n</script>`;
    });
  }
  return output;
}

async function inlineIconSprite(html: string): Promise<string> {
  if (!html.includes(RUNTIME_URLS.icons)) {
    return html;
  }
  const sprite = await readFile(runtimeFilePath(RUNTIME_URLS.icons), "utf8");
  const rewritten = html.replaceAll(`${RUNTIME_URLS.icons}#`, "#");
  return rewritten.replace(/<body([^>]*)>/i, `<body$1>\n${sprite}`);
}

async function inlineDataSources(
  html: string,
  artifactPath: string,
): Promise<string> {
  return replaceAsync(html, /<pi-data-source\b[^>]*>/gi, async (match) => {
    const tag = match[0];
    const source = attributeValue(tag, "src");
    if (!source?.startsWith("assets/")) {
      return tag;
    }
    const filePath = await resolveArtifactFile(artifactPath, source);
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const withoutSource = removeAttribute(tag, "src");
    return addAttribute(
      withoutSource,
      "data-pi-export-json",
      JSON.stringify(parsed),
    );
  });
}

async function inlineArtifactReferences(
  html: string,
  artifactPath: string,
): Promise<string> {
  let output = await replaceAsync(
    html,
    /\bsrcset\s*=\s*(["'])([^"']+)\1/gi,
    async (match) => {
      const candidates = (match[2] ?? "").split(/\s*,\s*/);
      const inlined: string[] = [];
      for (const candidate of candidates) {
        const parsed = /^(\S+)([\s\S]*)$/.exec(candidate);
        const reference = parsed?.[1] ?? "";
        const descriptor = parsed?.[2] ?? "";
        inlined.push(
          reference.startsWith("assets/")
            ? `${await artifactDataUrl(artifactPath, reference)}${descriptor}`
            : candidate,
        );
      }
      return `srcset=${match[1]}${inlined.join(", ")}${match[1]}`;
    },
  );

  output = await replaceAsync(
    output,
    /\b(src|href|poster)\s*=\s*(["'])(assets\/[^"']+)\2/gi,
    async (match) => {
      const dataUrl = await artifactDataUrl(artifactPath, match[3] ?? "");
      return `${match[1]}=${match[2]}${dataUrl}${match[2]}`;
    },
  );

  output = await replaceAsync(
    output,
    /url\(\s*(["']?)(assets\/[^"')]+)\1\s*\)/gi,
    async (match) => {
      const dataUrl = await artifactDataUrl(artifactPath, match[2] ?? "");
      return `url("${dataUrl}")`;
    },
  );
  return output;
}

async function artifactDataUrl(
  artifactPath: string,
  reference: string,
): Promise<string> {
  const filePath = await resolveArtifactFile(artifactPath, reference);
  const data = await readFile(filePath);
  const fragmentAt = reference.indexOf("#");
  const fragment = fragmentAt === -1 ? "" : reference.slice(fragmentAt);
  return `data:${mediaTypeForPath(filePath)};base64,${data.toString("base64")}${fragment}`;
}

async function resolveArtifactFile(
  artifactPath: string,
  reference: string,
): Promise<string> {
  const pathOnly = reference.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    throw new Error(`Artifact export has a malformed asset path: ${reference}`);
  }
  if (
    !decoded.startsWith("assets/") ||
    decoded.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Artifact export asset escapes its bundle: ${reference}`);
  }

  const candidate = resolve(artifactPath, decoded);
  if (!isPathInside(artifactPath, candidate)) {
    throw new Error(`Artifact export asset escapes its bundle: ${reference}`);
  }
  const [realBundle, realCandidate] = await Promise.all([
    realpath(artifactPath),
    realpath(candidate),
  ]);
  if (!isPathInside(realBundle, realCandidate)) {
    throw new Error(`Artifact export asset escapes its bundle: ${reference}`);
  }
  const fileStats = await stat(realCandidate);
  if (!fileStats.isFile()) {
    throw new Error(`Artifact export asset is not a file: ${reference}`);
  }
  return realCandidate;
}

async function inlineCssDependencies(
  css: string,
  cssFile: string,
  root: string,
): Promise<string> {
  return replaceAsync(
    css,
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    async (match) => {
      const reference = (match[2] ?? "").trim();
      if (/^(?:data:|https?:|#)/i.test(reference)) {
        return match[0];
      }
      const pathOnly = reference.split(/[?#]/, 1)[0] ?? "";
      const filePath = resolve(dirname(cssFile), decodeURIComponent(pathOnly));
      if (!isPathInside(root, filePath)) {
        throw new Error(
          `Runtime CSS asset escapes its namespace: ${reference}`,
        );
      }
      const data = await readFile(filePath);
      return `url("data:${mediaTypeForPath(filePath)};base64,${data.toString("base64")}")`;
    },
  );
}

function injectExportCsp(html: string, nonce: string): string {
  const withoutExisting = html.replace(
    /<meta\b[^>]*http-equiv\s*=\s*(["'])content-security-policy\1[^>]*>/gi,
    "",
  );
  const policy = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "img-src data:",
    "media-src data:",
    "font-src data:",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head\b[^>]*>/i.test(withoutExisting)) {
    return withoutExisting.replace(
      /<head\b[^>]*>/i,
      (head) => `${head}\n${meta}`,
    );
  }
  if (/<html\b[^>]*>/i.test(withoutExisting)) {
    return withoutExisting.replace(
      /<html\b[^>]*>/i,
      (root) => `${root}\n<head>${meta}</head>`,
    );
  }
  return `${meta}\n${withoutExisting}`;
}

function stripAuthoredExecution(html: string, runtimeNonce: string): string {
  const withoutScripts = html.replace(
    /<script\b([^>]*)>[\s\S]*?<\/script>/gi,
    (tag, attributes: string) => {
      if (
        /\bdata-pi-runtime\s*=/.test(attributes) &&
        attributeValue(attributes, "nonce") === runtimeNonce
      ) {
        return tag;
      }
      const type = attributeValue(attributes, "type")?.toLowerCase();
      return type === "application/json" || type === "application/ld+json"
        ? tag
        : "";
    },
  );
  return replaceOpeningTags(withoutScripts, (tag) =>
    tag
      .replace(/\s+on[a-z]+\s*=\s*(?:["'][\s\S]*?["']|[^\s>]+)/gi, "")
      .replace(
        /\b(href|src|xlink:href|action|formaction)\s*=\s*(?:(["'])\s*javascript:[\s\S]*?\2|javascript:[^\s>]+)/gi,
        (_match, name: string) => `${name}="#"`,
      ),
  );
}

function replaceOpeningTags(
  html: string,
  replacer: (tag: string) => string,
): string {
  let output = "";
  let cursor = 0;
  let searchFrom = 0;

  while (searchFrom < html.length) {
    const start = html.indexOf("<", searchFrom);
    if (start === -1) {
      break;
    }
    if (!/^<[A-Za-z][A-Za-z0-9:.-]*(?:\s|\/?>)/.test(html.slice(start))) {
      searchFrom = start + 1;
      continue;
    }

    const end = findTagEnd(html, start + 1);
    if (end === -1) {
      break;
    }
    output += html.slice(cursor, start);
    output += replacer(html.slice(start, end + 1));
    cursor = end + 1;
    searchFrom = cursor;
  }

  return output + html.slice(cursor);
}

function findTagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index] ?? "";
    if (quote) {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function runtimeFilePath(url: string): string {
  const segments = url.split("/").filter(Boolean);
  if (segments[0] !== "runtime" || !segments[1] || segments.length < 3) {
    throw new Error(`Invalid runtime URL: ${url}`);
  }
  const root = RUNTIME_ROOTS[segments[1]];
  if (!root) {
    throw new Error(`Unknown runtime namespace: ${segments[1]}`);
  }
  const filePath = resolve(root, segments.slice(2).join("/"));
  if (!isPathInside(root, filePath)) {
    throw new Error(`Runtime URL escapes its namespace: ${url}`);
  }
  return filePath;
}

function runtimeRootForUrl(url: string): string {
  const namespace = url.split("/").filter(Boolean)[1];
  const root = namespace ? RUNTIME_ROOTS[namespace] : undefined;
  if (!root) {
    throw new Error(`Unknown runtime URL: ${url}`);
  }
  return root;
}

function attributeValue(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${escapeRegex(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
    "i",
  ).exec(tag);
  return match?.[2];
}

function removeAttribute(tag: string, name: string): string {
  return tag.replace(
    new RegExp(`\\s+${escapeRegex(name)}\\s*=\\s*(["'])[\\s\\S]*?\\1`, "i"),
    "",
  );
}

function addAttribute(tag: string, name: string, value: string): string {
  const insertion = ` ${name}="${escapeHtml(value)}"`;
  return tag.replace(/\s*\/?>$/, (end) => `${insertion}${end}`);
}

async function replaceAsync(
  value: string,
  pattern: RegExp,
  replacer: (match: RegExpMatchArray) => Promise<string>,
): Promise<string> {
  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    output += value.slice(cursor, match.index);
    output += await replacer(match);
    cursor = match.index + match[0].length;
  }
  return output + value.slice(cursor);
}

function mediaTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css;charset=utf-8";
    case ".csv":
      return "text/csv;charset=utf-8";
    case ".gif":
      return "image/gif";
    case ".html":
      return "text/html;charset=utf-8";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".js":
      return "text/javascript;charset=utf-8";
    case ".json":
      return "application/json;charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain;charset=utf-8";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeScriptEnd(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

function escapeStyleEnd(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style");
}
