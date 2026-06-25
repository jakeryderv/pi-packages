import { resolve, sep } from "node:path";

export const BASELINE_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
].join("; ");

export interface PreviewServerState {
  url?: string;
  close: () => Promise<void>;
}

export function isPathInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);

  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  );
}

export async function createPreviewServerState(): Promise<PreviewServerState> {
  // MVP-1 wiring point: create a localhost-only server that serves the selected
  // artifact directory and package runtime files, rejects traversal with
  // isPathInside, and applies BASELINE_CSP to every response.
  return {
    close: async () => {},
  };
}
