import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { FileEntry } from "./types.ts";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".cabinet",
  "cabinet-output",
]);

const TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".css",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".log",
  ".ini",
  ".toml",
]);

export function sanitizeFolder(name: string) {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "其他";
}

export async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function previewOf(abs: string, ext: string, size: number) {
  if (size === 0) return "";
  if (size > 200_000) return "";
  if (!TEXT_EXTS.has(ext)) return "";
  try {
    const buf = await fs.readFile(abs);
    return buf.toString("utf8").slice(0, 1200);
  } catch {
    return "";
  }
}

export async function scanFolder(root: string, recursive: boolean) {
  const resolved = path.resolve(root);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error("路径不是文件夹");

  const files: FileEntry[] = [];

  async function walk(dir: string, relBase: string, depth: number) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (recursive && depth < 4) await walk(abs, rel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = await fs.stat(abs);
      const ext = path.extname(entry.name).toLowerCase();
      files.push({
        id: crypto.createHash("sha1").update(abs).digest("hex").slice(0, 12),
        name: entry.name,
        rel: rel.replaceAll("\\", "/"),
        abs,
        ext,
        size: st.size,
        mtime: st.mtimeMs,
        preview: await previewOf(abs, ext, st.size),
      });
    }
  }

  await walk(resolved, "", 0);
  files.sort((a, b) => a.rel.localeCompare(b.rel, "zh"));
  return { root: resolved, files };
}

export async function uniqueDest(dir: string, name: string) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let dest = path.join(dir, name);
  let n = 1;
  while (await pathExists(dest)) {
    dest = path.join(dir, `${stem}-${n}${ext}`);
    n += 1;
  }
  return dest;
}

export async function moveFile(from: string, to: string) {
  await ensureDir(path.dirname(to));
  try {
    await fs.rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      await fs.copyFile(from, to);
      await fs.unlink(from);
      return;
    }
    throw err;
  }
}
