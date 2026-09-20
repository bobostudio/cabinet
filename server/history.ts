import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunRecord } from "./types.ts";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = path.join(DATA_DIR, "history.json");

async function readAll(): Promise<RunRecord[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as RunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listRuns() {
  const all = await readAll();
  return all
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      elapsedMs: run.elapsedMs,
      root: run.root,
      dryRun: run.dryRun,
      moved: run.moved,
      classifier: run.classifier,
      fileCount: run.files.length,
      categoryCount: run.categories.length,
    }));
}

export async function getRun(id: string) {
  const all = await readAll();
  return all.find((r) => r.id === id) ?? null;
}

export async function saveRun(run: RunRecord) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const all = await readAll();
  const next = [run, ...all.filter((r) => r.id !== run.id)].slice(0, 80);
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
  return run;
}

export async function updateRun(id: string, patch: Partial<RunRecord>) {
  const all = await readAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
  return all[idx];
}
