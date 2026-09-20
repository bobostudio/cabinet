import path from "node:path";
import type { Category, FileDecision, FileEntry } from "./types.ts";
import { defaultCategories, deepseekAssign, proposeTaxonomy } from "./deepseek.ts";
import { jevClassifyFile, mapPool } from "./jev.ts";
import { sanitizeFolder, uniqueDest } from "./files.ts";

const EXT_MAP: Record<string, string> = {
  ".pdf": "documents",
  ".doc": "documents",
  ".docx": "documents",
  ".txt": "documents",
  ".md": "documents",
  ".rtf": "documents",
  ".xls": "spreadsheets",
  ".xlsx": "spreadsheets",
  ".csv": "spreadsheets",
  ".png": "images",
  ".jpg": "images",
  ".jpeg": "images",
  ".gif": "images",
  ".webp": "images",
  ".svg": "images",
  ".bmp": "images",
  ".mp4": "video",
  ".mov": "video",
  ".mkv": "video",
  ".avi": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".flac": "audio",
  ".m4a": "audio",
  ".js": "code",
  ".ts": "code",
  ".tsx": "code",
  ".jsx": "code",
  ".py": "code",
  ".json": "code",
  ".html": "code",
  ".css": "code",
  ".zip": "archives",
  ".rar": "archives",
  ".7z": "archives",
  ".gz": "archives",
};

export function demoAssign(file: FileEntry, categories: Category[]) {
  const want = EXT_MAP[file.ext] ?? "other";
  const hit = categories.find((c) => c.id === want) ?? categories.find((c) => c.id === "other") ?? categories[0];
  return { categoryId: hit.id, confidence: 0.74 };
}

export async function buildTaxonomy(
  files: FileEntry[],
  deepseekKey?: string,
): Promise<{ categories: Category[]; source: "deepseek" | "default" | "demo" }> {
  if (deepseekKey) {
    const categories = await proposeTaxonomy(deepseekKey, files);
    return { categories, source: "deepseek" };
  }
  return { categories: defaultCategories(), source: "default" };
}

export async function classifyFiles(opts: {
  root: string;
  files: FileEntry[];
  categories: Category[];
  typesafeKey?: string;
  deepseekKey?: string;
  onFile: (decision: FileDecision) => void | Promise<void>;
  onStart?: (file: FileEntry) => void | Promise<void>;
}): Promise<{ decisions: FileDecision[]; classifier: "jev" | "deepseek" | "demo" }> {
  const { files, categories, typesafeKey, deepseekKey, root, onFile, onStart } = opts;

  let prefill: Record<string, { categoryId: string; confidence: number }> = {};
  let classifier: "jev" | "deepseek" | "demo" = "demo";

  if (typesafeKey) classifier = "jev";
  else if (deepseekKey) classifier = "deepseek";

  if (classifier === "deepseek" && deepseekKey) {
    prefill = await deepseekAssign(deepseekKey, files, categories);
  }

  const catById = new Map(categories.map((c) => [c.id, c]));
  const other = categories.find((c) => c.id === "other") ?? categories[categories.length - 1];

  const decisions: FileDecision[] = [];

  const work = async (file: FileEntry): Promise<FileDecision> => {
    await onStart?.(file);
    const t0 = Date.now();
    let categoryId = other.id;
    let confidence = 0.5;
    if (classifier === "demo") {
      await new Promise((r) => setTimeout(r, 260));
    }
    try {
      if (classifier === "jev" && typesafeKey) {
        const r = await jevClassifyFile(typesafeKey, file, categories);
        categoryId = r.categoryId;
        confidence = r.confidence;
      } else if (classifier === "deepseek") {
        const r = prefill[file.id] ?? demoAssign(file, categories);
        categoryId = r.categoryId;
        confidence = r.confidence;
      } else {
        const r = demoAssign(file, categories);
        categoryId = r.categoryId;
        confidence = r.confidence;
      }
    } catch {
      const r = demoAssign(file, categories);
      categoryId = r.categoryId;
      confidence = Math.min(r.confidence, 0.4);
    }
    const cat = catById.get(categoryId) ?? other;
    const folder = sanitizeFolder(cat.folder);
    const destDir = path.join(root, folder);
    const dest = await uniqueDest(destDir, file.name);
    const decision: FileDecision = {
      fileId: file.id,
      name: file.name,
      from: file.abs,
      to: dest,
      categoryId: cat.id,
      folder,
      confidence,
      durationMs: Date.now() - t0,
      source: classifier,
    };
    decisions.push(decision);
    await onFile(decision);
    return decision;
  };

  if (classifier === "jev") {
    await mapPool(files, 4, work);
  } else {
    for (const file of files) await work(file);
  }

  return { decisions, classifier };
}
