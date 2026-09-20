export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 100));
  const tenths = total % 10;
  const secs = Math.floor(total / 10) % 60;
  const mins = Math.floor(total / 600);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function classifierLabel(c: string) {
  if (c === "jev") return "Jev";
  if (c === "deepseek") return "DeepSeek";
  return "演示";
}
