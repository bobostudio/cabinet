import type { Category, FileEntry } from "./types.ts";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";

type JevChoice = {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};

export async function jevClassifyFile(
  key: string,
  file: FileEntry,
  categories: Category[],
): Promise<{ categoryId: string; confidence: number }> {
  const criteria: Record<string, string> = {};
  for (const cat of categories) {
    criteria[cat.id] = `${cat.folder}. ${cat.description}`;
  }

  const body = {
    model: "jev-latest",
    state: {
      filename: file.name,
      relative_path: file.rel,
      extension: file.ext || "(none)",
      size_bytes: file.size,
      preview: file.preview || "(binary or empty)",
    },
    questions: {
      drawer: {
        type: "choice",
        instructions:
          "Which filing drawer should this file go into? Judge from the filename, extension, path, and any preview text. Pick the single best match. Use Other only when nothing else fits.",
        criteria,
      },
    },
  };

  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jev ${res.status}: ${text.slice(0, 280)}`);
  }

  const json = (await res.json()) as {
    answers?: { drawer?: JevChoice };
  };
  const answer = json.answers?.drawer;
  const choice = answer?.choice;
  const known = categories.find((c) => c.id === choice);
  const fallback = categories.find((c) => c.id === "other") ?? categories[categories.length - 1];
  const picked = known ?? fallback;
  const confidence =
    typeof answer?.confidence === "number"
      ? answer.confidence
      : answer?.probabilities?.[picked.id] ?? 0.5;
  return { categoryId: picked.id, confidence };
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
