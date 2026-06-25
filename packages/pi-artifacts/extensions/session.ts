import { createHash } from "node:crypto";

interface SessionManagerLike {
  getSessionFile?: () => string | undefined;
}

interface ContextLike {
  sessionManager?: SessionManagerLike;
}

export function getSessionFile(ctx: unknown): string | undefined {
  const context = ctx as ContextLike | undefined;
  return context?.sessionManager?.getSessionFile?.();
}

export function sessionKeyFromFile(sessionFile: string): string {
  return createHash("sha256").update(sessionFile).digest("hex");
}
