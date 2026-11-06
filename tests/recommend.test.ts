import { describe, expect, it } from "vitest";
import type { LeagueSnapshot } from "@/lib/domain/types";
import { recommendTrades } from "@/lib/engine/recommend";
import { analyzeTrade } from "@/lib/engine/trade";
import { presetById } from "@/lib/league/presets";
import { SnapshotProjectionProvider } from "@/lib/projections/snapshotProvider";
import { fbPlayer, makeFootballSnapshot } from "./helpers/snapshot";

const provider = new SnapshotProjectionProvider();
function project(snap: LeagueSnapshot) {
  const p = provider.project(snap, Object.keys(snap.players).map(Number));
  if (p.status !== "available") throw new Error(p.reason);
  return p;
}

// Starters QB, RB, WR, FLEX (RB/WR); active limit 6.
// Alpha has a spare QB (P2) and a weak RB; Beta has a weak QB and spare RBs.
const alpha = [fbPlayer(1, "QB", 20), fbPlayer(2, "QB", 18), fbPlayer(3, "RB", 5), fbPlayer(4, "WR", 10)];
const beta = [fbPlayer(11, "QB", 8), fbPlayer(12, "RB", 15), fbPlayer(13, "RB", 12), fbPlayer(14, "RB", 11), fbPlayer(15, "WR", 9)];
// Alpha before: QB 20 + RB 5 + WR 10 (no FLEX) = 35. Beta before: QB 8 + RB 15 + WR 9 + FLEX 12 = 44.

describe("recommendTrades", () => {
  it("finds the fairest trade, and the one that helps you most", () => {
    const snap = makeFootballSnapshot({ teamA: alpha, teamB: beta });
    const r = recommendTrades(snap, project(snap), { teamId: 1, offer: [2], partnerTeamId: null, maxReceive: 2 });

    // Fairest: QB 18 for RB 11. Alpha 20+11+10+5 = 46 (+11); Beta 18+15+9+12 = 54 (+10); the smaller gain (10) is the largest.
    // (RB 15 gives Alpha more, +15, but Beta only +6; RB 12 gives +12 and +9.)
    expect(r.fair[0]).toMatchObject({ partnerTeamName: "Beta", receive: [14], myDrops: [], partnerDrops: [], bothImprove: true });
    expect(r.fair[0].myDelta).toBeCloseTo(11);
    expect(r.fair[0].partnerDelta).toBeCloseTo(10);
    expect(r.fair.map((s) => s.receive)).toEqual(expect.arrayContaining([[12], [13]]));

    // QB 18 for RB 15 + RB 12: Alpha 20+15+10+12 = 57 (+22); Beta 18+11+9 = 38 (−6).
    expect(r.bestForMe[0]).toMatchObject({ receive: [12, 13], bothImprove: false });
    expect(r.bestForMe[0].myDelta).toBeCloseTo(22);
    expect(r.bestForMe[0].partnerDelta).toBeCloseTo(-6);

    for (const s of [...r.fair, ...r.bestForMe]) expect(s.myDelta).toBeGreaterThan(0);
  });

  it("matches the full trade analysis for a suggested trade", () => {
    const snap = makeFootballSnapshot({ teamA: alpha, teamB: beta });
    const s = recommendTrades(snap, project(snap), { teamId: 1, offer: [2], partnerTeamId: null, maxReceive: 2 }).bestForMe[0];
    const a = analyzeTrade(snap, {
      snapshotFetchedAt: snap.fetchedAt,
      teamA: { teamId: 1, sends: [2], drops: s.myDrops, adds: [] },
      teamB: { teamId: 2, sends: s.receive, drops: s.partnerDrops, adds: [] },
    }, provider);
    expect(a.teams[0].pointDelta).toBeCloseTo(s.myDelta);
    expect(a.teams[1].pointDelta).toBeCloseTo(s.partnerDelta);
  });

  it("leaves out packages that only add players who change nothing", () => {
    // Beta's QB 8 never starts for Alpha (QB 20 does), so "RB 11 + QB 8" scores the same for Alpha as RB 11 alone,
    // and Beta comes out the same too (its QB 8 was replaced by the incoming QB 18 either way).
    const snap = makeFootballSnapshot({ teamA: alpha, teamB: beta });
    const r = recommendTrades(snap, project(snap), { teamId: 1, offer: [2], partnerTeamId: null, maxReceive: 2, limit: 100 });
    const all = [...r.fair, ...r.bestForMe].map((s) => s.receive.join(","));
    expect(all).toContain("14");
    expect(all).not.toContain("11,14");
    expect(all).not.toContain("11,12");
  });

  it("respects the package size limit", () => {
    const snap = makeFootballSnapshot({ teamA: alpha, teamB: beta });
    const r = recommendTrades(snap, project(snap), { teamId: 1, offer: [2], partnerTeamId: 2, maxReceive: 1 });
    expect(r.bestForMe.every((s) => s.receive.length === 1)).toBe(true);
    expect(r.bestForMe[0].receive).toEqual([12]);
  });

  it("drops the lowest-projected player it didn't just receive when a roster overflows", () => {
    // Alpha is full (6): sending 1 and receiving 2 needs one drop; the RB 1 is the weakest.
    const full = [...alpha, fbPlayer(5, "WR", 2), fbPlayer(6, "RB", 1)];
    const snap = makeFootballSnapshot({ teamA: full, teamB: beta });
    const r = recommendTrades(snap, project(snap), { teamId: 1, offer: [2], partnerTeamId: null, maxReceive: 2 });
    const pair = r.bestForMe.find((s) => s.receive.length === 2)!;
    expect(pair.myDrops).toEqual([6]);
  });

  it("rejects offers it can't score", () => {
    const snap = makeFootballSnapshot({ teamA: [...alpha, fbPlayer(7, "WR", null)], teamB: beta });
    const proj = project(snap);
    expect(() => recommendTrades(snap, proj, { teamId: 1, offer: [12], partnerTeamId: null, maxReceive: 1 })).toThrow(/roster changed/);
    expect(() => recommendTrades(snap, proj, { teamId: 1, offer: [7], partnerTeamId: null, maxReceive: 1 })).toThrow(/No projection/);
    expect(() => recommendTrades(snap, proj, { teamId: 1, offer: [2], partnerTeamId: 1, maxReceive: 1 })).toThrow(/different team/);
  });

  it("searches a full 12-team, 17-player league quickly", () => {
    const positions = ["QB", "RB", "WR"] as const;
    const teams = Array.from({ length: 12 }, (_, t) =>
      Array.from({ length: 17 }, (_, i) => fbPlayer(1000 + t * 100 + i, positions[i % 3], 5 + ((t * 17 + i) * 7) % 20)),
    );
    const snap = makeFootballSnapshot({ teamA: teams[0], teamB: teams[1] });
    snap.settings.slots = presetById("ffl-ppr")!.slots;
    snap.settings.activeRosterLimit = 17;
    snap.teams = teams.map((roster, t) => ({ id: t + 1, name: `Team ${t + 1}`, abbrev: null, roster: roster.map((p) => ({ playerId: p.id, lineupSlotId: 20 })) }));
    for (const p of teams.flat()) snap.players[String(p.id)] = p;

    const started = performance.now();
    const r = recommendTrades(snap, project(snap), { teamId: 1, offer: [1000, 1001], partnerTeamId: null, maxReceive: 3 });
    const ms = performance.now() - started;
    // 11 partners × (17 + 136 + 680) packages.
    expect(r.evaluated).toBe(11 * 833);
    // About 1.2 s on a laptop; the bound is loose so slower CI machines don't flake.
    expect(ms).toBeLessThan(15_000);
  });
});
