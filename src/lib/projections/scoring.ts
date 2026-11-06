import type { ScoringItem, StatLine, StatSplit } from "@/lib/domain/types";

/**
 * Applies league scoring rules to a stat line. Per-position overrides are
 * keyed by lineup slot id (ESPN's encoding) and take precedence over the base
 * value for players whose primary position matches.
 */
/**
 * Upper bound on a single season stat value. No real fantasy counting stat
 * approaches this; ESPN's unofficial projection feed occasionally returns a
 * corrupt value in the millions, which would otherwise dominate a lineup.
 */
export const MAX_SANE_STAT = 100_000;

export function scoreStatLine(
  stats: StatLine,
  items: ScoringItem[],
  positionSlotId: number | null,
): number {
  let total = 0;
  for (const item of items) {
    const value = stats[String(item.statId)];
    if (value === undefined || !Number.isFinite(value) || Math.abs(value) > MAX_SANE_STAT) continue;
    const override =
      positionSlotId !== null ? item.pointsOverrides[String(positionSlotId)] : undefined;
    total += value * (override ?? item.points);
  }
  return total;
}

export type ScoreBasis = "provider-applied" | "computed-from-stats";

export interface ScoredValue {
  points: number;
  basis: ScoreBasis;
}

/**
 * League-scored projected points for a split. Prefers the provider's own
 * league-scored value; otherwise applies the league's scoring rules to the raw
 * projected stats. Returns null (never 0) when neither is present.
 */
export function scoreSplit(
  split: StatSplit | null | undefined,
  mode: "total" | "average",
  items: ScoringItem[],
  positionSlotId: number | null,
): ScoredValue | null {
  if (!split) return null;
  const applied = mode === "total" ? split.appliedTotal : split.appliedAverage;
  if (applied !== null && Number.isFinite(applied)) {
    return { points: applied, basis: "provider-applied" };
  }
  const stats = mode === "total" ? split.stats : split.averageStats;
  if (stats && Object.keys(stats).length > 0 && items.length > 0) {
    return { points: scoreStatLine(stats, items, positionSlotId), basis: "computed-from-stats" };
  }
  return null;
}
