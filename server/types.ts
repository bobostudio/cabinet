export type Category = {
  id: string;
  folder: string;
  description: string;
};

export type FileEntry = {
  id: string;
  name: string;
  rel: string;
  abs: string;
  ext: string;
  size: number;
  mtime: number;
  preview: string;
};

export type FileDecision = {
  fileId: string;
  name: string;
  from: string;
  to: string;
  categoryId: string;
  folder: string;
  confidence: number;
  durationMs: number;
  source: "jev" | "deepseek" | "demo";
};

export type Step = {
  t: number;
  kind: "scan" | "taxonomy" | "classify" | "plan" | "move" | "info" | "error";
  message: string;
  fileId?: string;
  categoryId?: string;
  durationMs?: number;
  confidence?: number;
};

export type RunRecord = {
  id: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  root: string;
  dryRun: boolean;
  moved: boolean;
  taxonomySource: "deepseek" | "default" | "demo";
  classifier: "jev" | "deepseek" | "demo";
  categories: Category[];
  files: FileEntry[];
  decisions: FileDecision[];
  steps: Step[];
};

export type RunRequest = {
  root: string;
  recursive?: boolean;
  dryRun?: boolean;
  apply?: boolean;
  typesafeKey?: string;
  deepseekKey?: string;
  runId?: string;
};
