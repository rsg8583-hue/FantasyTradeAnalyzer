import { describe, expect, it } from "vitest";
import { scoreSplit, scoreStatLine } from "@/lib/projections/scoring";
import { FB_SCORING, BB_SCORING, demoSnapshot } from "@/lib/demo/fixtures";
import type { ScoringItem } from "@/lib/domain/types";

const items: ScoringItem[] = [
  { statId: 53, points: 1, pointsOverrides: { "6": 1.5 } }, // reception; TE premium via slot 6 override
  { statId: 42, points: 0.1, pointsOverrides: {} },
  { statId: 20, points: -2, pointsOverrides: {} },
];

describe("league scoring", () => {
  it("applies each scoring item to the matching stat", () => {
    expect(scoreStatLine({ "53": 5, "42": 60, "20": 1 }, items, 4)).toBeCloseTo(5 + 6 - 2);
  });

  it("uses per-position overrides keyed by the player's position slot", () => {
    expect(scoreStatLine({ "53": 4 }, items, 6)).toBeCloseTo(6); // TE: 1.5 per reception
    expect(scoreStatLine({ "53": 4 }, items, 4)).toBeCloseTo(4); // WR: base value
  });

  it("ignores stats the league does not score", () => {
    expect(scoreStatLine({ "999": 50 }, items, null)).toBe(0);
  });

  it("ignores corrupt stat magnitudes from ESPN's flaky feed but keeps the rest", () => {
    // A real line plus one garbage value (6.1M receiving yards) must not blow up the score.
    expect(scoreStatLine({ "53": 5, "42": 6_166_595 }, items, 4)).toBeCloseTo(5);
  });

  it("prefers the source's league-scored total over recomputation", () => {
    const v = scoreSplit({ appliedTotal: 12.3, appliedAverage: null, stats: { "53": 100 }, averageStats: null }, "total", items, 4);
    expect(v).toEqual({ points: 12.3, basis: "provider-applied" });
  });

  it("computes from raw stats when no applied total exists", () => {
    const v = scoreSplit({ appliedTotal: null, appliedAverage: null, stats: { "53": 3 }, averageStats: null }, "total", items, 4);
    expect(v).toEqual({ points: 3, basis: "computed-from-stats" });
  });

  it("returns null — not zero — when the projection is missing", () => {
    expect(scoreSplit(null, "total", items, 4)).toBeNull();
    expect(scoreSplit({ appliedTotal: null, appliedAverage: null, stats: null, averageStats: null }, "total", items, 4)).toBeNull();
    expect(scoreSplit({ appliedTotal: null, appliedAverage: null, stats: {}, averageStats: null }, "total", items, 4)).toBeNull();
  });

  it("uses per-game averages in average mode", () => {
    const v = scoreSplit({ appliedTotal: null, appliedAverage: null, stats: null, averageStats: { "53": 2 } }, "average", items, 4);
    expect(v?.points).toBe(2);
  });

  it("demo fixtures score consistently under their league rules", () => {
    const fb = demoSnapshot("football");
    const qb = Object.values(fb.players).find((p) => p.position === "QB" && p.projections.byScoringPeriod["9"]);
    expect(qb).toBeDefined();
    const pts = scoreStatLine(qb!.projections.byScoringPeriod["9"].stats!, FB_SCORING, qb!.positionSlotId);
    expect(pts).toBeGreaterThan(5);
    const bb = demoSnapshot("basketball");
    const anyBb = Object.values(bb.players).find((p) => p.projections.season)!;
    expect(scoreStatLine(anyBb.projections.season!.averageStats!, BB_SCORING, anyBb.positionSlotId)).toBeGreaterThan(5);
  });
});
