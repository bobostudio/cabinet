import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLineRight,
  ClockCounterClockwise,
  FolderOpen,
  Key,
  Pause,
  Play,
  SkipBack,
} from "@phosphor-icons/react";
import { applyRun, fetchSampleRoot, getRun, listHistory, scanFolder, streamRun } from "./api";
import { classifierLabel, formatBytes, formatClock, formatWhen } from "./format";
import type {
  Category,
  FileDecision,
  FileEntry,
  HistoryItem,
  Phase,
  RunRecord,
  Step,
} from "./types";

const SPEEDS = [0.5, 1, 2, 4];

function tabClass(ext: string) {
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "ext-img";
  if ([".js", ".ts", ".tsx", ".py", ".json", ".css", ".html"].includes(ext)) return "ext-code";
  if ([".mp4", ".mov", ".mp3", ".wav"].includes(ext)) return "ext-av";
  if ([".zip", ".rar", ".7z"].includes(ext)) return "ext-zip";
  return "ext-doc";
}

function phaseLabel(phase: Phase, moved: boolean) {
  if (phase === "running" || phase === "scanning") return "分拣中";
  if (phase === "replaying") return "回放";
  if (phase === "moving") return "正在收入抽屉";
  if (phase === "planned") return "方案就绪";
  if (phase === "done") return moved ? "已归档" : "已完成";
  return "待命";
}

export default function App() {
  const [root, setRoot] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [typesafeKey, setTypesafeKey] = useState(() => localStorage.getItem("cabinet.typesafe") ?? "");
  const [deepseekKey, setDeepseekKey] = useState(() => localStorage.getItem("cabinet.deepseek") ?? "");
  const [keysOpen, setKeysOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [decisions, setDecisions] = useState<FileDecision[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [autoApply, setAutoApply] = useState(() => localStorage.getItem("cabinet.autoApply") !== "0");
  const [liveMs, setLiveMs] = useState(0);
  const [msLive, setMsLive] = useState(false);
  const [msHit, setMsHit] = useState(0);
  const replayRef = useRef<RunRecord | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const autoApplyRef = useRef(autoApply);
  const msStartRef = useRef<number | null>(null);
  const currentIdRef = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem("cabinet.typesafe", typesafeKey);
    localStorage.setItem("cabinet.deepseek", deepseekKey);
    localStorage.setItem("cabinet.autoApply", autoApply ? "1" : "0");
    autoApplyRef.current = autoApply;
  }, [typesafeKey, deepseekKey, autoApply]);

  useEffect(() => {
    if (!msLive) return;
    let raf = 0;
    const tick = () => {
      if (msStartRef.current != null) {
        setLiveMs(Math.max(0, Math.round(performance.now() - msStartRef.current)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [msLive]);

  useEffect(() => {
    listHistory().then(setHistory).catch(() => {});
    fetchSampleRoot().then((p) => {
      setRoot((cur) => cur || p);
    });
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [steps.length]);

  useEffect(() => {
    if (!playing || !replayRef.current) return;
    const total = Math.max(replayRef.current.elapsedMs, 1);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setPlayhead((h) => {
        const next = Math.min(total, h + dt * speed);
        if (next >= total) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  useEffect(() => {
    const rec = replayRef.current;
    if (!rec || phase !== "replaying") return;
    const visible = rec.steps.filter((s) => s.t <= playhead);
    setSteps(visible);
    const filed = new Map<string, FileDecision>();
    for (const s of visible) {
      if (s.kind === "classify" && s.fileId) {
        const d = rec.decisions.find((x) => x.fileId === s.fileId);
        if (d) filed.set(d.fileId, d);
      }
    }
    const list = [...filed.values()];
    setDecisions(list);
    const last = [...visible].reverse().find((s) => s.fileId);
    setCurrentId(last?.fileId ?? null);
    setElapsedMs(playhead);
    const lastClassify = [...visible].reverse().find((s) => s.kind === "classify" && s.durationMs != null);
    if (lastClassify?.durationMs != null) {
      setLiveMs(lastClassify.durationMs);
      setMsLive(false);
    }
  }, [playhead, phase]);

  const decided = useMemo(() => new Map(decisions.map((d) => [d.fileId, d])), [decisions]);
  const current = files.find((f) => f.id === currentId) ?? files.find((f) => !decided.has(f.id)) ?? files[0];
  const currentDecision = current ? decided.get(current.id) : undefined;
  const demo = !typesafeKey && !deepseekKey;

  function resetBoard() {
    setDecisions([]);
    setSteps([]);
    setCategories([]);
    setCurrentId(null);
    setElapsedMs(0);
    setPlayhead(0);
    setPlaying(false);
    setError("");
    setLiveMs(0);
    setMsLive(false);
    msStartRef.current = null;
    currentIdRef.current = null;
    replayRef.current = null;
  }

  async function onScan() {
    setError("");
    setPhase("scanning");
    resetBoard();
    try {
      const scanned = await scanFolder(root, recursive);
      setRoot(scanned.root);
      setFiles(scanned.files);
      setPhase("idle");
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    }
  }

  async function onRun() {
    setError("");
    resetBoard();
    setPhase("running");
    const t0 = performance.now();
    const timer = window.setInterval(() => setElapsedMs(performance.now() - t0), 80);
    let finished: RunRecord | null = null;
    try {
      await streamRun(
        { root, recursive, typesafeKey, deepseekKey },
        (event) => {
          const type = String(event.type);
          if (type === "files") setFiles(event.files as FileEntry[]);
          if (type === "taxonomy") setCategories(event.categories as Category[]);
          if (type === "classify-start") {
            const fileId = String(event.fileId ?? "");
            currentIdRef.current = fileId;
            setCurrentId(fileId);
            msStartRef.current = performance.now();
            setMsLive(true);
            setLiveMs(0);
          }
          if (type === "step") {
            const step = event.step as Step;
            setSteps((s) => [...s, step]);
            if (step.fileId) setCurrentId(step.fileId);
          }
          if (type === "decision") {
            const d = event.decision as FileDecision;
            setDecisions((xs) => [...xs.filter((x) => x.fileId !== d.fileId), d]);
            if (!currentIdRef.current || d.fileId === currentIdRef.current) {
              setMsLive(false);
              setLiveMs(d.durationMs);
              setMsHit((n) => n + 1);
              currentIdRef.current = d.fileId;
              setCurrentId(d.fileId);
            }
          }
          if (type === "done") {
            const rec = event.run as RunRecord | undefined;
            if (rec) {
              finished = rec;
              setRun(rec);
              setFiles(rec.files);
              setCategories(rec.categories);
              setDecisions(rec.decisions);
              setSteps(rec.steps);
              setElapsedMs(rec.elapsedMs);
              setMsLive(false);
              const last = rec.decisions[rec.decisions.length - 1];
              if (last) setLiveMs(last.durationMs);
              setPhase(autoApplyRef.current ? "moving" : "planned");
            } else {
              setPhase("idle");
            }
            listHistory().then(setHistory);
          }
          if (type === "error") {
            setError(String(event.error ?? "分拣失败"));
            setPhase("idle");
            setMsLive(false);
          }
        },
      );
      if (finished && autoApplyRef.current && !finished.moved) {
        await applyRecord(finished);
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
      setMsLive(false);
    } finally {
      window.clearInterval(timer);
    }
  }

  async function applyRecord(target: RunRecord) {
    setPhase("moving");
    setError("");
    try {
      const next = await applyRun(target.id);
      setRun(next);
      setSteps(next.steps);
      setElapsedMs(next.elapsedMs);
      setPhase("done");
      listHistory().then(setHistory);
    } catch (err) {
      setError((err as Error).message);
      setPhase("planned");
    }
  }

  async function onApply() {
    if (!run) return;
    await applyRecord(run);
  }

  async function loadHistory(id: string) {
    const rec = await getRun(id);
    replayRef.current = rec;
    setRun(rec);
    setRoot(rec.root);
    setFiles(rec.files);
    setCategories(rec.categories);
    setDecisions([]);
    setSteps([]);
    setPlayhead(0);
    setElapsedMs(0);
    setPhase("replaying");
    setPlaying(true);
    setHistOpen(false);
  }

  const duration = run?.elapsedMs ?? elapsedMs;
  const busy = phase === "running" || phase === "scanning" || phase === "moving";
  const avgMs = decisions.length
    ? Math.round(decisions.reduce((s, d) => s + d.durationMs, 0) / decisions.length)
    : 0;
  const shownMs = msLive ? liveMs : currentDecision?.durationMs ?? liveMs;
  const speedName = classifierLabel(run?.classifier ?? (typesafeKey ? "jev" : deepseekKey ? "deepseek" : "demo"));
  const playMs = phase === "replaying" ? playhead : elapsedMs;
  const playPct = duration > 0 ? Math.min(100, (playMs / Math.max(duration, 1)) * 100) : 0;
  const filePct = files.length ? Math.min(100, (decisions.length / files.length) * 100) : 0;

  return (
    <div className="shell">
      <header className="rail">
        <div className="brand">
          <Archive size={22} weight="fill" color="#e24a16" />
          <strong>CABINET</strong>
          <span>文件抽匣</span>
        </div>
        <div className="path">
          <input
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="粘贴要整理的文件夹路径"
            spellCheck={false}
          />
          <label className="chk">
            <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
            含子目录
          </label>
          <label className={`chk${autoApply ? " on" : ""}`}>
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(e) => setAutoApply(e.target.checked)}
            />
            自动收入抽屉
          </label>
          <button
            className="btn ghost"
            onClick={async () => setRoot(await fetchSampleRoot())}
            disabled={busy}
          >
            示例
          </button>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => setKeysOpen(true)}>
            <Key size={16} /> 密钥
          </button>
          <button className="btn ghost" onClick={() => setHistOpen(true)}>
            <ClockCounterClockwise size={16} /> 历史
          </button>
          <button className="btn" onClick={onScan} disabled={busy || !root}>
            <FolderOpen size={16} /> 扫描
          </button>
          <button className="btn primary" onClick={onRun} disabled={busy || !root}>
            开始分拣
          </button>
        </div>
      </header>

      <div className="body">
      {demo && (
        <p className="banner">
          未填写密钥，当前是演示模式：按扩展名分拣。密钥写好后会走 Jev / DeepSeek。
          {autoApply ? " 自动收入抽屉已开启。" : " 自动收入已关闭，分拣后需手动收入。"}
        </p>
      )}
      {error && <p className="banner">{error}</p>}

      <main className="workspace">
        <section className="col">
          <div className="col-h">
            <h2>台面</h2>
            <b>{files.length} 份</b>
          </div>
          <div className="slips">
            {files.length === 0 && <div className="empty">扫描一个文件夹，文件会像卡片一样摊在这里。</div>}
            {files.map((f) => (
              <article
                key={f.id}
                className={`slip${currentId === f.id ? " is-active" : ""}${decided.has(f.id) ? " is-filed" : ""}`}
              >
                <span className={`slip-tab ${tabClass(f.ext)}`} />
                <div>
                  <strong>{f.name}</strong>
                  <em>{f.rel}</em>
                </div>
                <i>{formatBytes(f.size)}</i>
              </article>
            ))}
          </div>
        </section>

        <section className="stage">
          <div className="lightbox">
            <div className="lightbox-copy">
              <div>
                <div className="kicker">
                  {phaseLabel(phase, Boolean(run?.moved))} · {speedName}
                </div>
                <h1 className="filename">{current?.name ?? "还没有文件"}</h1>
                <div className="meta-row">
                  <span>{current ? formatBytes(current.size) : "0 B"}</span>
                  <span>{current?.ext || "无后缀"}</span>
                  <span>{currentDecision ? `${currentDecision.folder}` : "未入屉"}</span>
                </div>
              </div>
              <div>
                <div className="bar">
                  <span style={{ width: `${Math.round((currentDecision?.confidence ?? 0) * 100)}%` }} />
                </div>
                <p className="stage-copy">
                  {msLive
                    ? `${speedName} 正在判定本件`
                    : currentDecision
                      ? `置信 ${Math.round(currentDecision.confidence * 100)}%`
                      : "本件耗时会打在右侧。数字越小，Jev 越快。"}
                </p>
              </div>
            </div>
            <div className={`speed-readout${msLive ? " live" : msHit ? " hit" : ""}`} key={msHit}>
              <b>{shownMs}</b>
              <small>{msLive ? "ms 正在判定" : "ms 本件"}</small>
              <small className="avg">
                {avgMs > 0 ? `均 ${avgMs} ms/件 · ${decisions.length} 份` : `${speedName} 单次判定`}
              </small>
            </div>
          </div>
          <div className="log" ref={logRef}>
            {steps.length === 0 && <div className="empty">分拣步骤会按时间写在这里，回放时也会原样重演。</div>}
            {steps.map((s, i) => (
              <div className="log-row" key={`${s.t}-${i}`}>
                <time>{formatClock(s.t)}</time>
                <span className={`dot ${s.kind}`} />
                <p>{s.message}</p>
                <span className="log-ms">{s.durationMs != null ? `${s.durationMs} ms` : ""}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="col">
          <div className="col-h">
            <h2>抽屉</h2>
            <b>{categories.length} 类</b>
          </div>
          <div className="drawers">
            {categories.length === 0 && <div className="empty">分类方案会在分拣开始后出现。</div>}
            {categories.map((c) => {
              const items = decisions.filter((d) => d.categoryId === c.id);
              return (
                <article className="drawer" key={c.id}>
                  <div className="drawer-face">
                    <h3>{c.folder}</h3>
                    <small>{items.length}</small>
                  </div>
                  <div className="handle" />
                  <div className="chips">
                    {items.map((d) => (
                      <span className="chip" key={d.fileId} title={`${Math.round(d.confidence * 100)}%`}>
                        {d.name}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      </div>

      <footer className="deck">
        <div className="transport">
          <button
            className="round"
            onClick={() => {
              setPlayhead(0);
              setPlaying(false);
              if (replayRef.current) {
                setDecisions([]);
                setSteps([]);
              }
            }}
            aria-label="回到开头"
          >
            <SkipBack size={16} weight="fill" />
          </button>
          <button
            className="round play"
            onClick={() => {
              if (phase !== "replaying" && run) {
                replayRef.current = run;
                setPhase("replaying");
                setPlayhead(0);
                setDecisions([]);
                setSteps([]);
              }
              setPlaying((p) => !p);
            }}
            disabled={!run}
            aria-label={playing ? "暂停" : "回放"}
          >
            {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
          </button>
        </div>
        <div className="scrub">
          <div className="deck-progress">
            <b>
              {decisions.length}/{files.length || 0}
            </b>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              value={playMs}
              style={{
                background: `linear-gradient(90deg, #e24a16 ${playPct}%, #2a241e ${playPct}%)`,
              }}
              onChange={(e) => {
                if (!run) return;
                replayRef.current = run;
                setPhase("replaying");
                setPlaying(false);
                setPlayhead(Number(e.target.value));
              }}
            />
          </div>
          <div className="times">
            <span>{formatClock(playMs)}</span>
            <span className="file-bar" aria-hidden="true">
              <span style={{ width: `${filePct}%` }} />
            </span>
            <span>{formatClock(duration)}</span>
          </div>
        </div>
        <div className="speed">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
        <div className="actions">
          <span className={`status-pill${demo ? " warn" : ""}`}>
            {phaseLabel(phase, Boolean(run?.moved))}
          </span>
          <button
            className="btn primary"
            onClick={onApply}
            disabled={!run || run.moved || busy}
            title={autoApply ? "分拣结束后会自动收入" : "手动把文件收进抽屉"}
          >
            <ArrowLineRight size={16} />
            {autoApply ? "自动收入" : "收入抽屉"}
          </button>
        </div>
      </footer>

      {keysOpen && (
        <>
          <div className="sheet-back" onClick={() => setKeysOpen(false)} />
          <aside className="sheet">
            <h2>密钥</h2>
            <p className="lead">只存在这台电脑的浏览器里，随每次分拣发给本地服务。DeepSeek 可先留空。</p>
            <div className="field">
              <label htmlFor="k-jev">TypeSafe / Jev API Key</label>
              <input
                id="k-jev"
                type="password"
                value={typesafeKey}
                onChange={(e) => setTypesafeKey(e.target.value)}
                placeholder="sk-...  分类主模型"
              />
            </div>
            <div className="field">
              <label htmlFor="k-ds">DeepSeek API Key</label>
              <input
                id="k-ds"
                type="password"
                value={deepseekKey}
                onChange={(e) => setDeepseekKey(e.target.value)}
                placeholder="稍后填写。填写后会先拟定中文抽屉名"
              />
            </div>
            <button className="btn primary" onClick={() => setKeysOpen(false)}>
              收好
            </button>
          </aside>
        </>
      )}

      {histOpen && (
        <>
          <div className="sheet-back" onClick={() => setHistOpen(false)} />
          <aside className="sheet">
            <h2>历史</h2>
            <p className="lead">每次分拣的时间、步骤都留着。点一条就能按原速度回放，方便录屏。</p>
            {history.length === 0 && <div className="empty">还没有记录。</div>}
            {history.map((h) => (
              <button className="hist-item" key={h.id} onClick={() => loadHistory(h.id)}>
                <strong>
                  {h.fileCount} 个文件 · {h.categoryCount} 个抽屉 · {classifierLabel(h.classifier)}
                </strong>
                <span>
                  {formatWhen(h.startedAt)} · {formatClock(h.elapsedMs)} · {h.moved ? "已移动" : "仅方案"}
                </span>
                <span>{h.root}</span>
              </button>
            ))}
          </aside>
        </>
      )}
    </div>
  );
}
