import { describe, expect, it } from "vitest";
import { hungarian, optimizeLineup, starterSlots } from "@/lib/engine/lineup";
import type { RosterSlot } from "@/lib/domain/types";

const slots = (defs: [number, string, number][]): RosterSlot[] =>
  defs.map(([slotId, name, count]) => ({ slotId, name, count, kind: "starter" as const }));

describe("hungarian", () => {
  it("finds the minimum-cost assignment", () => {
    const a = hungarian([
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ]);
    const cost = a.reduce((s, c, r) => s + [[4, 1, 3], [2, 0, 5], [3, 2, 2]][r][c], 0);
    expect(cost).toBe(5);
  });
});

describe("optimizeLineup", () => {
  it("starts the best eligible player in each slot", () => {
    const res = optimizeLineup(
      [
        { playerId: 1, eligibleSlotIds: [0], points: 20 },
        { playerId: 2, eligibleSlotIds: [0], points: 15 },
        { playerId: 3, eligibleSlotIds: [2], points: 10 },
      ],
      slots([[0, "QB", 1], [2, "RB", 1]]),
    );
    expect(res.total).toBe(30);
    expect(res.assignments.map((a) => a.playerId)).toEqual([1, 3]);
  });

  it("fills a flexible slot with the best leftover eligible player", () => {
    const res = optimizeLineup(
      [
        { playerId: 1, eligibleSlotIds: [2, 23], points: 14 },
        { playerId: 2, eligibleSlotIds: [2, 23], points: 12 },
        { playerId: 3, eligibleSlotIds: [4, 23], points: 11 },
        { playerId: 4, eligibleSlotIds: [4, 23], points: 9 },
      ],
      slots([[2, "RB", 1], [4, "WR", 1], [23, "FLEX", 1]]),
    );
    expect(res.total).toBe(14 + 11 + 12);
    const flex = res.assignments.find((a) => a.slotName === "FLEX");
    expect(flex?.playerId).toBe(2);
  });

  it("never counts the same player in two slots", () => {
    const res = optimizeLineup(
      [{ playerId: 1, eligibleSlotIds: [2, 23], points: 30 }],
      slots([[2, "RB", 1], [23, "FLEX", 1]]),
    );
    expect(res.total).toBe(30);
    expect(res.assignments.filter((a) => a.playerId === 1)).toHaveLength(1);
    expect(res.unfilledSlots).toEqual(["FLEX"]);
  });

  it("beats a greedy fill when a flexible player must move to a restricted slot", () => {
    // Greedy would put the TE (10) into WR/TE first and leave TE empty.
    const res = optimizeLineup(
      [
        { playerId: 1, eligibleSlotIds: [6, 5], points: 10 },
        { playerId: 2, eligibleSlotIds: [5], points: 8 },
      ],
      slots([[5, "WR/TE", 1], [6, "TE", 1]]),
    );
    expect(res.total).toBe(18);
    expect(res.unfilledSlots).toEqual([]);
  });

  it("leaves a slot empty rather than starting an ineligible player", () => {
    const res = optimizeLineup([{ playerId: 1, eligibleSlotIds: [4], points: 50 }], slots([[0, "QB", 1]]));
    expect(res.total).toBe(0);
    expect(res.unfilledSlots).toEqual(["QB"]);
  });

  it("handles multi-count slots and more players than slots", () => {
    const players = Array.from({ length: 10 }, (_, i) => ({ playerId: i + 1, eligibleSlotIds: [11], points: i + 1 }));
    const res = optimizeLineup(players, slots([[11, "UT", 3]]));
    expect(res.total).toBe(10 + 9 + 8);
  });

  it("expands slot counts in slot-id order and ignores bench/IR", () => {
    const s: RosterSlot[] = [
      { slotId: 20, name: "BE", count: 5, kind: "bench" },
      { slotId: 2, name: "RB", count: 2, kind: "starter" },
      { slotId: 0, name: "QB", count: 1, kind: "starter" },
    ];
    expect(starterSlots(s).map((x) => x.name)).toEqual(["QB", "RB", "RB"]);
  });
});
