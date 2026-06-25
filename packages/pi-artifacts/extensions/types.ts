export type ArtifactStack = "markdown";

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
