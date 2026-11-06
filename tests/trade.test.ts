import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/domain/errors";
import type { LeagueSnapshot, Player } from "@/lib/domain/types";
import { analyzeTrade, deriveVerdict, evaluateRoster, improves, percentChange, planTrade } from "@/lib/engine/trade";
import type { TeamTradeResult } from "@/lib/engine/types";
import { SnapshotProjectionProvider } from "@/lib/projections/snapshotProvider";
import { demoSnapshot } from "@/lib/demo/fixtures";
import { fbPlayer, makeFootballSnapshot, trade } from "./helpers/snapshot";

const provider = new SnapshotProjectionProvider();

// Alpha (5 of 6 active spots): QB 20, RB 15, WR 12, RB 8, WR 6 → lineup 20+15+12+FLEX 8 = 55
const alpha = () => [fbPlayer(101, "QB", 20), fbPlayer(102, "RB", 15), fbPlayer(103, "WR", 12), fbPlayer(104, "RB", 8), fbPlayer(105, "WR", 6)];
// Beta (6 of 6, full): QB 18, RB 10, WR 14, WR 11, RB 5, WR 4 → 18+10+14+FLEX 11 = 53
const beta = () => [fbPlayer(201, "QB", 18), fbPlayer(202, "RB", 10), fbPlayer(204, "WR", 14), fbPlayer(203, "WR", 11), fbPlayer(205, "RB", 5), fbPlayer(206, "WR", 4)];

function expectAppError(fn: () => unknown, code: string): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    return e as AppError;
  }
  throw new Error("expected an AppError");
}

describe("benefit percentages", () => {
  it("computes each team's percentage independently from its own baseline", () => {
    const snap = makeFootballSnapshot({ teamA: alpha(), teamB: beta() });
    const r = analyzeTrade(snap, trade(snap, { sends: [102] }, { sends: [204] }), provider);
    const [a, b] = r.teams;
    expect(a.pointsBefore).toBe(55);
    expect(a.pointsAfter).toBe(54); // QB20 + RB8 + WR14 + FLEX WR12
    expect(b.pointsBefore).toBe(53);
    expect(b.pointsAfter).toBe(54); // QB18 + RB15 + WR11 + FLEX RB10
    expect(a.percentChange).toBeCloseTo((100 * -1) / 55, 10);
    expect(b.percentChange).toBeCloseTo((100 * 1) / 53, 10);
    expect(a.pointDelta).toBe(-1);
    expect(b.pointDelta).toBe(1);
    // Independent: they do not sum to 100 (or to anything in particular).
    expect((a.percentChange ?? 0) + (b.percentChange ?? 0)).not.toBeCloseTo(100);
    expect(r.verdict).toBe("one_improves");
  });

  it("matches the documented example: 120 → 126 is +5%", () => {
    expect(percentChange(120, 126)).toBeCloseTo(5, 10);
  });

  it("returns not-available for a zero baseline", () => {
    expect(percentChange(0, 10)).toBeNull();
    const snap = makeFootballSnapshot({
      teamA: alpha(),
      teamB: [fbPlayer(201, "QB", 0), fbPlayer(202, "RB", 0), fbPlayer(204, "WR", 0)],
    });
    const r = analyzeTrade(snap, trade(snap, { sends: [105] }, { sends: [204] }), provider);
    const b = r.teams[1];
    // Points are still known and shown; only the percentage is unavailable.
    expect(b.pointsBefore).toBe(0);
    expect(b.pointDelta).toBe(6);
    expect(b.percentChange).toBeNull();
    expect(b.status).toBe("insufficient");
    expect(b.insufficientReasons.join(" ")).toMatch(/baseline is zero/);
    expect(r.verdict).toBe("insufficient_data");
  });

  it("treats a percentage that rounds to 0.0% as not improving", () => {
    expect(improves(0.04)).toBe(false);
    expect(improves(0.05)).toBe(true);
    expect(improves(-0.01)).toBe(false);
  });

  it("derives all verdicts", () => {
    const t = (pct: number | null) => ({ percentChange: pct }) as TeamTradeResult;
    expect(deriveVerdict([t(3), t(1)])).toBe("both_improve");
    expect(deriveVerdict([t(3), t(-1)])).toBe("one_improves");
    expect(deriveVerdict([t(-3), t(0)])).toBe("neither_improves");
    expect(deriveVerdict([t(3), t(null)])).toBe("insufficient_data");
  });
});

describe("missing projections", () => {
  it("never treats a traded player's missing projection as zero", () => {
    const b = beta();
    b[2] = fbPlayer(204, "WR", null); // traded player has no projection
    const snap = makeFootballSnapshot({ teamA: alpha(), teamB: b });
    const r = analyzeTrade(snap, trade(snap, { sends: [102] }, { sends: [204] }), provider);
    for (const t of r.teams) {
      expect(t.status).toBe("insufficient");
      expect(t.percentChange).toBeNull();
      expect(t.pointDelta).toBeNull();
      expect(t.insufficientReasons.join(" ")).toMatch(/Missing projections for P204/);
    }
    expect(r.verdict).toBe("insufficient_data");
    expect(r.players["204"].projectedTotal).toBeNull();
  });

  it("excludes an uninvolved player without a projection from both lineups and warns", () => {
    const a = alpha();
    a[4] = fbPlayer(105, "WR", null);
    const snap = makeFootballSnapshot({ teamA: a, teamB: beta() });
    const r = analyzeTrade(snap, trade(snap, { sends: [102] }, { sends: [204] }), provider);
    expect(r.teams[0].status).toBe("ok");
    expect(r.teams[0].before.excludedMissing).toEqual([105]);
    expect(r.teams[0].warnings.join(" ")).toMatch(/No projection for P105/);
  });

  it("counts a known bye week as zero but an unknown schedule as missing", () => {
    const onBye = fbPlayer(150, "RB", null, 2); // pro team 2 has no week-1 game
    const unknown = fbPlayer(151, "RB", null, 9); // pro team 9 not in schedule
    const snap = makeFootballSnapshot({ teamA: [...alpha(), onBye], teamB: beta(), freeAgents: [unknown] });
    const set = provider.project(snap, [150, 151]);
    expect(set.status).toBe("available");
    if (set.status !== "available") return;
    expect(set.byPlayer["150"].total).toBe(0);
    expect(set.byPlayer["150"].basis).toMatch(/bye/);
    expect(set.byPlayer["151"].total).toBeNull();
  });
});

describe("uneven trades, drops and replacements", () => {
  // Beta sends three players for one: Alpha goes 5 - 1 + 3 = 7 > 6 and must drop 1; Beta goes to 4 (2 open spots).
  const build = () => {
    const fa = [fbPlayer(301, "RB", 7), fbPlayer(302, "WR", null)];
    return makeFootballSnapshot({ teamA: alpha(), teamB: beta(), freeAgents: fa });
  };

  it("requires the receiving team to choose drops", () => {
    const snap = build();
    const plan = planTrade(snap, trade(snap, { sends: [102] }, { sends: [204, 205, 206] }));
    expect(plan.plans).toBeNull();
    expect(plan.errors.join(" ")).toMatch(/Alpha would have 7 active players \(limit 6\) and must drop exactly 1/);
  });

  it("accounts for drops and open roster spots", () => {
    const snap = build();
    const r = analyzeTrade(snap, trade(snap, { sends: [102], drops: [105] }, { sends: [204, 205, 206] }), provider);
    const [a, b] = r.teams;
    expect(a.requiredDrops).toBe(1);
    expect(a.after.roster).not.toContain(105);
    expect(b.openSpotsAfter).toBe(2);
    expect(b.assumptions.join(" ")).toMatch(/2 open roster spot\(s\); no replacement was selected/);
    expect(b.pointsAfter).toBe(18 + 10 + 11 + 15); // QB, RB 10, WR 11, FLEX RB 15
  });

  it("includes a selected free-agent replacement in the after lineup", () => {
    const snap = build();
    const withAdd = analyzeTrade(snap, trade(snap, { sends: [102], drops: [105] }, { sends: [204, 205, 203], adds: [301] }), provider);
    const b = withAdd.teams[1];
    expect(b.adds).toEqual([301]);
    expect(b.after.roster).toContain(301);
    // QB18 + RB15 + WR4 + FLEX max(RB10, RB7) = 47
    expect(b.pointsAfter).toBe(18 + 15 + 4 + 10);
    expect(b.openSpotsAfter).toBe(1);
  });

  it("marks a team insufficient when its replacement has no projection", () => {
    const snap = build();
    const r = analyzeTrade(snap, trade(snap, { sends: [102], drops: [105] }, { sends: [204, 205, 206], adds: [302] }), provider);
    expect(r.teams[1].status).toBe("insufficient");
    expect(r.teams[0].status).toBe("ok");
  });

  it("rejects replacements that are not free agents or exceed open spots", () => {
    const snap = build();
    const notFa = planTrade(snap, trade(snap, { sends: [102], drops: [105] }, { sends: [204, 205, 206], adds: [101] }));
    expect(notFa.errors.join(" ")).toMatch(/Not in the free-agent pool/);
    // Alpha: 5 - 1 + 1 = 5 of 6 → one open spot, but two replacements selected.
    const tooMany = planTrade(snap, trade(snap, { sends: [102], adds: [301, 302] }, { sends: [204] }));
    expect(tooMany.errors.join(" ")).toMatch(/Alpha has 1 open roster spot\(s\) but 2 replacement\(s\) were selected/);
  });

  it("rejects replacements when free-agent data is unavailable", () => {
    const snap: LeagueSnapshot = { ...build(), freeAgents: { status: "unavailable", reason: "test" } };
    const plan = planTrade(snap, trade(snap, { sends: [102], drops: [105] }, { sends: [204, 205, 206], adds: [301] }));
    expect(plan.errors.join(" ")).toMatch(/free-agent data is unavailable/);
  });

  it("does not count IR-slot players against the active limit", () => {
    const ir = fbPlayer(190, "RB", null);
    const snap = makeFootballSnapshot({ teamA: alpha(), teamB: beta(), irA: [ir] });
    const r = analyzeTrade(snap, trade(snap, { sends: [102] }, { sends: [204] }), provider);
    expect(r.teams[0].before.roster).not.toContain(190);
    expect(r.teams[0].requiredDrops).toBe(0);
  });
});

describe("trade validation", () => {
  const snap = makeFootballSnapshot({ teamA: alpha(), teamB: beta() });

  it("rejects empty trades", () => {
    expect(planTrade(snap, trade(snap, { sends: [] }, { sends: [] })).errors).toEqual(["Add at least one player to the trade."]);
  });

  it("rejects the same team on both sides", () => {
    const req = trade(snap, { sends: [101] }, { sends: [] });
    req.teamB.teamId = 1;
    expect(planTrade(snap, req).errors[0]).toMatch(/two different teams/);
  });

  it("rejects duplicates", () => {
    expect(planTrade(snap, trade(snap, { sends: [101, 101] }, { sends: [201] })).errors[0]).toMatch(/only once/);
  });

  it("rejects players the team does not own", () => {
    const res = planTrade(snap, trade(snap, { sends: [201] }, { sends: [101] }));
    expect(res.errors.join(" ")).toMatch(/Alpha no longer rosters: P201/);
    expect(res.stale).toBe(false);
  });

  it("reports a conflict when rosters changed since the trade was built", () => {
    const e = expectAppError(
      () => analyzeTrade(snap, trade(snap, { sends: [201] }, { sends: [101] }, "2026-10-28T00:00:00.000Z"), provider),
      "CONFLICT",
    );
    expect(e.message).toMatch(/no longer rosters/);
  });

  it("refuses to analyze unsupported formats", () => {
    const cat: LeagueSnapshot = { ...snap, format: { supported: false, reasons: ["Category league."] } };
    expectAppError(() => analyzeTrade(cat, trade(cat, { sends: [101] }, { sends: [201] }), provider), "UNSUPPORTED_FORMAT");
  });

  it("warns when a team can no longer fill a starting slot", () => {
    // Alpha trades its only QB for a WR.
    const r = analyzeTrade(snap, trade(snap, { sends: [101] }, { sends: [204] }), provider);
    expect(r.teams[0].warnings.join(" ")).toMatch(/cannot fill these starting slots.*QB/);
  });
});

describe("basketball daily lineups", () => {
  const bbPlayer = (id: number, perGame: number | null, proTeamId: number): Player => ({
    id,
    name: `B${id}`,
    position: "PG",
    positionSlotId: 0,
    eligibleSlotIds: [0, 11, 12],
    proTeamId,
    proTeamAbbrev: null,
    injuryStatus: null,
    projections: {
      byScoringPeriod: {},
      season: perGame === null ? null : { appliedTotal: null, appliedAverage: perGame, stats: null, averageStats: null },
    },
  });

  const snapshot = (players: Player[]): LeagueSnapshot => {
    const base = makeFootballSnapshot({ teamA: [], teamB: [] });
    return {
      ...base,
      rosterScoringPeriod: 2,
      settings: {
        ...base.settings,
        sport: "basketball",
        slots: [{ slotId: 11, name: "UT", count: 1, kind: "starter" }, { slotId: 12, name: "BE", count: 3, kind: "bench" }],
        currentScoringPeriod: 2,
        currentMatchupPeriod: 1,
        matchupPeriods: { "1": [1, 2, 3, 4] },
      },
      players: Object.fromEntries(players.map((p) => [String(p.id), p])),
      // Team 1 plays day 2 only; team 2 plays days 2, 3, 4; day 1 is in the past.
      proSchedule: { status: "available", value: { gamesByTeam: { "1": { "1": 1, "2": 1 }, "2": { "2": 1, "3": 1, "4": 1 } } } },
    };
  };

  it("optimizes each remaining day using only players with a game that day", () => {
    const snap = snapshot([bbPlayer(1, 30, 1), bbPlayer(2, 20, 2)]);
    const set = provider.project(snap, [1, 2]);
    expect(set.status).toBe("available");
    if (set.status !== "available") return;
    expect(set.horizon.scoringPeriodIds).toEqual([2, 3, 4]);
    const ev = evaluateRoster([1, 2], snap, set);
    // Day 2: best of (30, 20) = 30; days 3 and 4: only player 2 plays → 20 each.
    expect(ev.periods.map((p) => p.total)).toEqual([30, 20, 20]);
    expect(ev.total).toBe(70);
    expect(set.byPlayer["1"].gamesScheduled).toBe(1);
  });

  it("reports projections unavailable when the schedule is unavailable", () => {
    const snap: LeagueSnapshot = { ...snapshot([bbPlayer(1, 30, 1)]), proSchedule: { status: "unavailable", reason: "down" } };
    const set = provider.project(snap, [1]);
    expect(set.status).toBe("unavailable");
  });

  it("keeps a missing per-game projection missing", () => {
    const snap = snapshot([bbPlayer(1, null, 1)]);
    const set = provider.project(snap, [1]);
    if (set.status !== "available") throw new Error("expected available");
    expect(set.byPlayer["1"].total).toBeNull();
    expect(set.byPlayer["1"].perPeriod).toEqual([null, 0, 0]);
  });
});

describe("demo leagues end to end", () => {
  for (const sport of ["football", "basketball"] as const) {
    it(`analyzes a ${sport} demo trade`, () => {
      const snap = demoSnapshot(sport);
      const [t1, t2] = snap.teams;
      const r = analyzeTrade(
        snap,
        { snapshotFetchedAt: snap.fetchedAt, teamA: { teamId: t1.id, sends: [t1.roster[2].playerId], drops: [], adds: [] }, teamB: { teamId: t2.id, sends: [t2.roster[2].playerId], drops: [], adds: [] } },
        provider,
      );
      expect(r.teams[0].status).toBe("ok");
      expect(r.teams[1].status).toBe("ok");
      expect(r.horizon.label).toMatch(sport === "football" ? /week 9/ : /Matchup period 3/);
    });
  }
});
