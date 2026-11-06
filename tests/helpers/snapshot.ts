import type { LeagueSnapshot, Player, RosterSlot } from "@/lib/domain/types";
import type { TradeRequest } from "@/lib/domain/apiSchemas";

export const FB_TEST_SLOTS: RosterSlot[] = [
  { slotId: 0, name: "QB", count: 1, kind: "starter" },
  { slotId: 2, name: "RB", count: 1, kind: "starter" },
  { slotId: 4, name: "WR", count: 1, kind: "starter" },
  { slotId: 23, name: "FLEX", count: 1, kind: "starter" },
  { slotId: 20, name: "BE", count: 2, kind: "bench" },
  { slotId: 21, name: "IR", count: 1, kind: "ir" },
];

const ELIG: Record<string, number[]> = {
  QB: [0, 20, 21],
  RB: [2, 23, 20, 21],
  WR: [4, 23, 20, 21],
};

/** Football player with a week-1 projection already scored (appliedTotal). `null` = missing projection. */
export function fbPlayer(id: number, pos: "QB" | "RB" | "WR", week1: number | null, proTeamId = 1): Player {
  return {
    id,
    name: `P${id}`,
    position: pos,
    positionSlotId: pos === "QB" ? 0 : pos === "RB" ? 2 : 4,
    eligibleSlotIds: ELIG[pos],
    proTeamId,
    proTeamAbbrev: `T${proTeamId}`,
    injuryStatus: null,
    projections: {
      season: null,
      byScoringPeriod:
        week1 === null ? {} : { "1": { appliedTotal: week1, appliedAverage: null, stats: null, averageStats: null } },
    },
  };
}

/**
 * Two-team football league, week 1. Starters: QB, RB, WR, FLEX; 2 bench → active limit 6.
 */
export function makeFootballSnapshot(opts: {
  teamA: Player[];
  teamB: Player[];
  freeAgents?: Player[];
  irA?: Player[];
  fetchedAt?: string;
  schedule?: Record<string, Record<string, number>>;
}): LeagueSnapshot {
  const all = [...opts.teamA, ...opts.teamB, ...(opts.freeAgents ?? []), ...(opts.irA ?? [])];
  return {
    source: "demo",
    sourceLabel: "Test fixture",
    fetchedAt: opts.fetchedAt ?? "2026-10-29T12:00:00.000Z",
    rosterScoringPeriod: 1,
    settings: {
      leagueId: "1",
      name: "Test League",
      sport: "football",
      season: 2026,
      scoringType: "H2H_POINTS",
      scoringLabel: "Head-to-head points",
      teamCount: 2,
      keeperCount: 0,
      slots: FB_TEST_SLOTS,
      scoringItems: [{ statId: 53, points: 1, pointsOverrides: {} }],
      activeRosterLimit: 6,
      irSlotCount: 1,
      currentMatchupPeriod: 1,
      currentScoringPeriod: 1,
      finalScoringPeriod: 17,
      matchupPeriods: { "1": [1] },
    },
    format: { supported: true },
    teams: [
      {
        id: 1,
        name: "Alpha",
        abbrev: "A",
        roster: [
          ...opts.teamA.map((p) => ({ playerId: p.id, lineupSlotId: 20 })),
          ...(opts.irA ?? []).map((p) => ({ playerId: p.id, lineupSlotId: 21 })),
        ],
      },
      { id: 2, name: "Beta", abbrev: "B", roster: opts.teamB.map((p) => ({ playerId: p.id, lineupSlotId: 20 })) },
    ],
    players: Object.fromEntries(all.map((p) => [String(p.id), p])),
    freeAgents: { status: "available", value: (opts.freeAgents ?? []).map((p) => p.id) },
    proSchedule: { status: "available", value: { gamesByTeam: opts.schedule ?? { "1": { "1": 1 }, "2": {} } } },
    warnings: [],
  };
}

export function trade(
  snapshot: LeagueSnapshot,
  a: { sends: number[]; drops?: number[]; adds?: number[] },
  b: { sends: number[]; drops?: number[]; adds?: number[] },
  fetchedAt = snapshot.fetchedAt,
): TradeRequest {
  return {
    snapshotFetchedAt: fetchedAt,
    teamA: { teamId: 1, sends: a.sends, drops: a.drops ?? [], adds: a.adds ?? [] },
    teamB: { teamId: 2, sends: b.sends, drops: b.drops ?? [], adds: b.adds ?? [] },
  };
}
