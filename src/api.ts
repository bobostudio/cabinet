import type { FileEntry, HistoryItem, RunRecord } from "./types";

export async function fetchSampleRoot() {
  const res = await fetch("/api/sample-root");
  const json = (await res.json()) as { root: string };
  return json.root;
}

export async function scanFolder(root: string, recursive: boolean) {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root, recursive }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "扫描失败");
  return json as { root: string; files: FileEntry[] };
}

export async function listHistory() {
  const res = await fetch("/api/history");
  return (await res.json()) as HistoryItem[];
}

export async function getRun(id: string) {
  const res = await fetch(`/api/history/${id}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "读取失败");
  return json as RunRecord;
}

export async function applyRun(runId: string) {
  const res = await fetch("/api/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "移动失败");
  return json.run as RunRecord;
}

export async function streamRun(
  body: {
    root: string;
    recursive: boolean;
    typesafeKey: string;
    deepseekKey: string;
  },
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.body) throw new Error("无法读取分拣流");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)));
    }
  }
}
