import { round1 } from "@/lib/engine/trade";

export { formatPct } from "@/lib/ai/input";

export function formatPoints(n: number): string {
  return round1(n).toFixed(1);
}

export function formatDelta(n: number): string {
  const r = round1(n);
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${Math.abs(r).toFixed(1)}`;
}

export function direction(pct: number | null): "up" | "down" | "flat" | "na" {
  if (pct === null) return "na";
  const r = round1(pct);
  return r > 0 ? "up" : r < 0 ? "down" : "flat";
}

export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hr ago`;
}

export function absoluteTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
