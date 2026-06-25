import type { RenderArtifactDetails } from "../types";

export async function validateMarkdownArtifact(
  _entryPath: string,
): Promise<Pick<RenderArtifactDetails, "warnings" | "errors">> {
  // MVP-1 wiring point: Prettier autofix, markdownlint, KaTeX strict, and
  // custom portability checks run here. Mermaid remains warn-only/skipped until
  // headless Node parsing is proven reliable.
  return { warnings: [], errors: [] };
}
