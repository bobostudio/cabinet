import type { Category, FileEntry } from "./types.ts";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

const DEFAULT_CATEGORIES: Category[] = [
  { id: "documents", folder: "文档", description: "Text documents, notes, contracts, PDFs of writing" },
  { id: "spreadsheets", folder: "表格", description: "Spreadsheets, CSV, ledgers" },
  { id: "images", folder: "图片", description: "Photos, screenshots, design stills, SVG" },
  { id: "video", folder: "视频", description: "Video files" },
  { id: "audio", folder: "音频", description: "Audio and voice notes" },
  { id: "code", folder: "代码", description: "Source code, configs, scripts" },
  { id: "archives", folder: "压缩包", description: "Zip, rar, 7z and similar archives" },
  { id: "other", folder: "其他", description: "Anything that does not fit the other drawers" },
];

export function defaultCategories() {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

function slug(s: string) {
  const ascii = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii || `c${Math.random().toString(36).slice(2, 7)}`;
}

async function chatJson(key: string, prompt: string) {
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You design filing taxonomies. Reply with JSON only. Folder names in Simplified Chinese, descriptions in English.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 280)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content) as Record<string, unknown>;
}

export async function proposeTaxonomy(key: string, files: FileEntry[]): Promise<Category[]> {
  const names = files.slice(0, 80).map((f) => f.rel);
  const parsed = await chatJson(
    key,
    `Propose 4 to 10 filing drawers for these files. Include an "other" drawer.
Files:\n${names.join("\n")}

JSON shape:
{"categories":[{"id":"snake_id","folder":"中文文件夹名","description":"English what belongs here"}]}`,
  );
  const raw = Array.isArray(parsed.categories) ? parsed.categories : [];
  const cats: Category[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const folder = String(rec.folder ?? rec.name ?? "").trim();
    if (!folder) continue;
    let id = String(rec.id ?? slug(folder)).replace(/[^a-z0-9_-]/gi, "_") || slug(folder);
    if (seen.has(id)) id = `${id}_${cats.length}`;
    seen.add(id);
    cats.push({
      id,
      folder: folder.slice(0, 40),
      description: String(rec.description ?? folder),
    });
  }
  if (!cats.some((c) => c.id === "other")) {
    cats.push({
      id: "other",
      folder: "其他",
      description: "Anything that does not fit the other drawers",
    });
  }
  return cats.length >= 3 ? cats : defaultCategories();
}

export async function deepseekAssign(
  key: string,
  files: FileEntry[],
  categories: Category[],
): Promise<Record<string, { categoryId: string; confidence: number }>> {
  const parsed = await chatJson(
    key,
    `Assign each file to exactly one category id.
Categories:\n${categories.map((c) => `${c.id} | ${c.folder} | ${c.description}`).join("\n")}
Files:\n${files.map((f) => `${f.id}\t${f.rel}`).join("\n")}

JSON shape:
{"assignments":[{"fileId":"...","categoryId":"...","confidence":0.0}]}
confidence is 0 to 1.`,
  );
  const raw = Array.isArray(parsed.assignments) ? parsed.assignments : [];
  const map: Record<string, { categoryId: string; confidence: number }> = {};
  const ids = new Set(categories.map((c) => c.id));
  const other = categories.find((c) => c.id === "other")?.id ?? categories[0].id;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const fileId = String(rec.fileId ?? rec.id ?? "");
    let categoryId = String(rec.categoryId ?? other);
    if (!ids.has(categoryId)) categoryId = other;
    const confidence = Math.min(1, Math.max(0, Number(rec.confidence) || 0.62));
    if (fileId) map[fileId] = { categoryId, confidence };
  }
  return map;
}
