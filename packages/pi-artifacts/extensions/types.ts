export type ArtifactStack = "markdown" | "html";

export interface ArtifactRenderStatus {
  ok: boolean;
  warnings: number;
  errors: number;
  rendered: string;
  warningCodes?: string[];
  errorCodes?: string[];
}

export interface ArtifactManifest {
  id: string;
  title: string;
  stack: ArtifactStack;
  entry: string;
  created: string;
  updated: string;
  cwd: string;
  sessionFile?: string;
  sessionKey?: string;
  lastRender?: ArtifactRenderStatus;
}

export interface ScaffoldArtifactDetails {
  id: string;
  path: string;
  entry: string;
  manifestPath: string;
}

export interface ValidationFinding {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface RenderArtifactDetails {
  ok: boolean;
  warnings: ValidationFinding[];
  errors: ValidationFinding[];
  url?: string;
}
