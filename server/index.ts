import express from "express";
import cors from "cors";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { RunRecord, RunRequest, Step } from "./types.ts";
import { moveFile, scanFolder } from "./files.ts";
import { buildTaxonomy, classifyFiles } from "./classify.ts";
import { getRun, listRuns, saveRun, updateRun } from "./history.ts";

const PORT = 8787;
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function sse(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  return send;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/sample-root", (_req, res) => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "inbox");
  res.json({ root });
});

app.post("/api/scan", async (req, res) => {
  try {
    const root = String(req.body?.root ?? "").trim();
    const recursive = Boolean(req.body?.recursive);
    if (!root) return res.status(400).json({ error: "请填写文件夹路径" });
    const scanned = await scanFolder(root, recursive);
    res.json(scanned);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/history", async (_req, res) => {
  res.json(await listRuns());
});

app.get("/api/history/:id", async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "找不到这次分拣" });
  res.json(run);
});

app.post("/api/run", async (req, res) => {
  const body = req.body as RunRequest;
  const root = String(body.root ?? "").trim();
  const recursive = Boolean(body.recursive);
  const typesafeKey = body.typesafeKey?.trim();
  const deepseekKey = body.deepseekKey?.trim();
  const send = sse(res);
  const t0 = Date.now();
  const steps: Step[] = [];
  const clock = () => Date.now() - t0;

  const log = (step: Omit<Step, "t">) => {
    const full: Step = { t: clock(), ...step };
    steps.push(full);
    send({ type: "step", step: full, elapsedMs: clock() });
  };

  try {
    if (!root) throw new Error("请填写文件夹路径");
    log({ kind: "scan", message: `打开目录 ${root}` });
    const scanned = await scanFolder(root, recursive);
    send({ type: "files", files: scanned.files, root: scanned.root });
    log({
      kind: "scan",
      message: `扫到 ${scanned.files.length} 个文件`,
    });
    if (scanned.files.length === 0) {
      send({ type: "done", elapsedMs: clock(), empty: true });
      res.end();
      return;
    }

    log({
      kind: "taxonomy",
      message: deepseekKey ? "DeepSeek 正在拟定抽屉名" : "使用默认抽屉",
    });
    const tax = await buildTaxonomy(scanned.files, deepseekKey || undefined);
    send({ type: "taxonomy", categories: tax.categories, source: tax.source });
    log({
      kind: "taxonomy",
      message: `抽屉 ${tax.categories.map((c) => c.folder).join(" / ")}`,
    });

    const classifierHint = typesafeKey ? "Jev" : deepseekKey ? "DeepSeek" : "演示规则";
    log({ kind: "info", message: `分类器：${classifierHint}` });

    const { decisions, classifier } = await classifyFiles({
      root: scanned.root,
      files: scanned.files,
      categories: tax.categories,
      typesafeKey,
      deepseekKey,
      onStart: (file) => {
        send({ type: "classify-start", fileId: file.id, name: file.name, elapsedMs: clock() });
      },
      onFile: (decision) => {
        log({
          kind: "classify",
          message: `${decision.name} → ${decision.folder}  (${Math.round(decision.confidence * 100)}%)`,
          fileId: decision.fileId,
          categoryId: decision.categoryId,
          durationMs: decision.durationMs,
          confidence: decision.confidence,
        });
        send({ type: "decision", decision, elapsedMs: clock() });
      },
    });

    const elapsedMs = clock();
    const record: RunRecord = {
      id: crypto.randomUUID(),
      startedAt: new Date(Date.now() - elapsedMs).toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedMs,
      root: scanned.root,
      dryRun: true,
      moved: false,
      taxonomySource: tax.source,
      classifier,
      categories: tax.categories,
      files: scanned.files,
      decisions,
      steps,
    };
    await saveRun(record);
    log({
      kind: "plan",
      message: `方案就绪，用时 ${(elapsedMs / 1000).toFixed(1)}s。尚未移动文件。`,
    });
    send({ type: "done", run: record, elapsedMs });
    res.end();
  } catch (err) {
    log({ kind: "error", message: (err as Error).message });
    send({ type: "error", error: (err as Error).message, elapsedMs: clock() });
    res.end();
  }
});

app.post("/api/apply", async (req, res) => {
  try {
    const runId = String(req.body?.runId ?? "");
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: "找不到这次分拣" });
    if (run.moved) return res.json({ run, skipped: true });

    const t0 = Date.now();
    const extra: Step[] = [];
    for (const d of run.decisions) {
      const t = Date.now();
      await moveFile(d.from, d.to);
      extra.push({
        t: run.elapsedMs + (Date.now() - t0),
        kind: "move",
        message: `已收入 ${d.folder} / ${path.basename(d.to)}`,
        fileId: d.fileId,
        categoryId: d.categoryId,
        durationMs: Date.now() - t,
      });
    }
    extra.push({
      t: run.elapsedMs + (Date.now() - t0),
      kind: "info",
      message: `移动完成，${run.decisions.length} 个文件已归位`,
    });
    const updated = await updateRun(runId, {
      moved: true,
      dryRun: false,
      finishedAt: new Date().toISOString(),
      elapsedMs: run.elapsedMs + (Date.now() - t0),
      steps: [...run.steps, ...extra],
    });
    res.json({ run: updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`cabinet server http://127.0.0.1:${PORT}`);
});
