import type { RosterSlot } from "@/lib/domain/types";

export interface LineupCandidate {
  playerId: number;
  eligibleSlotIds: number[];
  /** Projected points for this scoring period. Missing projections must be filtered out before calling. */
  points: number;
}

export interface SlotAssignment {
  slotId: number;
  slotName: string;
  playerId: number | null;
  points: number;
}

export interface OptimizedLineup {
  total: number;
  assignments: SlotAssignment[];
  unfilledSlots: string[];
}

/** Expands slot counts into individual starting slots, in slot-id order. */
export function starterSlots(slots: RosterSlot[]): { slotId: number; name: string }[] {
  return slots
    .filter((s) => s.kind === "starter")
    .sort((a, b) => a.slotId - b.slotId)
    .flatMap((s) => Array.from({ length: s.count }, () => ({ slotId: s.slotId, name: s.name })));
}

/**
 * Hungarian algorithm (min-cost assignment) on a square cost matrix.
 * Returns assignment[row] = column. O(n^3), fine for fantasy roster sizes.
 */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  return assignment;
}

/**
 * Finds the legal starting lineup with the highest projected total. Each
 * player fills at most one slot and only slots listed in their eligibility, so
 * flexible slots (FLEX, UT, G/F...) can never double-count a player. A slot
 * with no eligible player (or only negative-projection players) is left empty
 * and scores 0.
 */
export function optimizeLineup(candidates: LineupCandidate[], slots: RosterSlot[]): OptimizedLineup {
  const starters = starterSlots(slots);
  if (starters.length === 0) return { total: 0, assignments: [], unfilledSlots: [] };
  const players = [...candidates].sort((a, b) => a.playerId - b.playerId);
  const nP = players.length;
  const nS = starters.length;
  // Rows: real players + nS "empty slot" pseudo-players.
  // Columns: real slots + nP "bench" pseudo-slots. Every pseudo pairing costs 0.
  const size = nP + nS;
  const FORBIDDEN = 1e9;
  const cost: number[][] = [];
  for (let r = 0; r < size; r++) {
    const row: number[] = new Array(size).fill(0);
    if (r < nP) {
      const pl = players[r];
      for (let c = 0; c < nS; c++) {
        row[c] = pl.eligibleSlotIds.includes(starters[c].slotId) ? -pl.points : FORBIDDEN;
      }
    }
    cost.push(row);
  }

  const assignment = hungarian(cost);
  const bySlot = new Map<number, number>();
  for (let r = 0; r < nP; r++) {
    const c = assignment[r];
    if (c >= 0 && c < nS && cost[r][c] < FORBIDDEN) bySlot.set(c, r);
  }

  let total = 0;
  const assignments: SlotAssignment[] = starters.map((slot, c) => {
    const r = bySlot.get(c);
    if (r === undefined) return { slotId: slot.slotId, slotName: slot.name, playerId: null, points: 0 };
    total += players[r].points;
    return { slotId: slot.slotId, slotName: slot.name, playerId: players[r].playerId, points: players[r].points };
  });
  const unfilledSlots = assignments.filter((a) => a.playerId === null).map((a) => a.slotName);
  return { total, assignments, unfilledSlots };
}
