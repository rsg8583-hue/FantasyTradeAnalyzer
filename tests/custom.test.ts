import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/domain/errors";
import { analyzeTrade } from "@/lib/engine/trade";
import { EspnClient } from "@/lib/espn/client";
import { fetchPlayerPool, getPlayerPool, searchPool } from "@/lib/espn/playerPool";
import { buildCustomSnapshot } from "@/lib/custom/provider";
import { applyAction, MAX_TEAMS, maxRosterSize, newCustomLeague } from "@/lib/custom/mutate";
import type { CustomLeague } from "@/lib/custom/types";
import { defaultPresetId, presetById, presetsForSport } from "@/lib/league/presets";
import { FullSeasonProjectionProvider } from "@/lib/projections/fullSeasonProvider";
import ffl from "./fixtures/espn-ffl-player-pool.trimmed.json";
import fba from "./fixtures/espn-fba-player-pool.trimmed.json";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function poolClient(fixture: unknown, spy?: (url: URL) => void) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    spy?.(url);
    return json(fixture);
  });
  return new EspnClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
}

describe("player pool", () => {
  it("fetches the public players endpoint without cookies and keeps projectable players", async () => {
    let seen: URL | null = null;
    const client = poolClient(ffl, (u) => (seen = u));
    const pool = await fetchPlayerPool("football", 2026, client);
    expect(seen!.pathname).toBe("/apis/v3/games/ffl/seasons/2026/players");
    expect(pool.entries.length).toBeGreaterThanOrEqual(6);
    expect(pool.entries.length).toBeLessThanOrEqual(ffl.length);
    for (const { player } of pool.entries) {
      expect(player.projections.season?.stats).toBeTruthy();
      expect(player.position).not.toBe("?");
    }
  });

  it("ranks search by projected points under the chosen scoring and excludes taken players", async () => {
    const pool = await fetchPlayerPool("football", 2026, poolClient(ffl));
    const items = presetById("ffl-ppr")!.scoringItems;
    const all = searchPool(pool, "", items, 40);
    expect(all.length).toBe(pool.entries.length);
    // sorted descending by projected points
    for (let i = 1; i < all.length; i++) expect(all[i - 1].projectedPoints).toBeGreaterThanOrEqual(all[i].projectedPoints);
    const top = all[0];
    const without = searchPool(pool, "", items, 40, new Set([top.id]));
    expect(without.find((p) => p.id === top.id)).toBeUndefined();
    // name search
    const named = searchPool(pool, "roquan", items, 40);
    expect(named.every((p) => p.name.toLowerCase().includes("roquan"))).toBe(true);
  });

  it("basketball pool parses season projections", async () => {
    const pool = await fetchPlayerPool("basketball", 2026, poolClient(fba));
    expect(pool.entries.length).toBe(fba.length);
    const westbrook = [...pool.byId.values()].find((p) => p.name.includes("Westbrook"));
    expect(westbrook?.projections.season?.stats).toBeTruthy();
  });

  it("errors when ESPN returns no projectable players", async () => {
    await expect(fetchPlayerPool("football", 2026, poolClient([]))).rejects.toBeInstanceOf(AppError);
  });

  it("caches and de-duplicates concurrent pool fetches", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      await Promise.resolve();
      return json(ffl);
    });
    const client = new EspnClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    let t = 1000;
    const [a, b] = await Promise.all([
      getPlayerPool("football", 2026, { client, now: () => t }),
      getPlayerPool("football", 2026, { client, now: () => t }),
    ]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    t += 1000;
    await getPlayerPool("football", 2026, { client, now: () => t }); // within TTL → cached
    expect(calls).toBe(1);
  });
});

describe("custom league mutations", () => {
  const exists = (id: number) => ffl.some((p) => p.id === id);
  const freshLeague = (): CustomLeague => newCustomLeague({ name: "My League", sport: "football", season: 2026, presetId: "ffl-ppr" });

  it("adds, renames, and removes teams with validation", () => {
    const l = freshLeague();
    applyAction(l, { action: "addTeam", name: "Alpha" }, exists);
    applyAction(l, { action: "addTeam", name: "Beta" }, exists);
    expect(l.teams.map((t) => t.name)).toEqual(["Alpha", "Beta"]);
    expect(() => applyAction(l, { action: "addTeam", name: "alpha" }, exists)).toThrow(/already exists/);
    applyAction(l, { action: "renameTeam", teamId: l.teams[0].id, name: "Alpha Prime" }, exists);
    expect(l.teams[0].name).toBe("Alpha Prime");
    applyAction(l, { action: "removeTeam", teamId: l.teams[0].id }, exists);
    expect(l.teams.map((t) => t.name)).toEqual(["Beta"]);
  });

  it("enforces the team cap", () => {
    const l = freshLeague();
    for (let i = 0; i < MAX_TEAMS; i++) applyAction(l, { action: "addTeam", name: `T${i}` }, exists);
    expect(() => applyAction(l, { action: "addTeam", name: "overflow" }, exists)).toThrow(/at most/);
  });

  it("adds and removes players, rejecting duplicates, unknowns, and overfilled rosters", () => {
    const l = freshLeague();
    applyAction(l, { action: "addTeam", name: "A" }, exists);
    applyAction(l, { action: "addTeam", name: "B" }, exists);
    const [a, b] = l.teams;
    applyAction(l, { action: "addPlayer", teamId: a.id, playerId: ffl[0].id }, exists);
    expect(a.playerIds).toContain(ffl[0].id);
    // same player anywhere → conflict
    expect(() => applyAction(l, { action: "addPlayer", teamId: b.id, playerId: ffl[0].id }, exists)).toThrow(/already on a team/);
    // unknown player
    expect(() => applyAction(l, { action: "addPlayer", teamId: a.id, playerId: 999999 }, exists)).toThrow(/not in ESPN/);
    applyAction(l, { action: "removePlayer", teamId: a.id, playerId: ffl[0].id }, exists);
    expect(a.playerIds).toEqual([]);
  });

  it("enforces the roster size cap", () => {
    const l = freshLeague();
    l.presetId = "ffl-ppr";
    const cap = maxRosterSize(l);
    expect(cap).toBeGreaterThan(0);
    applyAction(l, { action: "addTeam", name: "A" }, exists);
    const a = l.teams[0];
    // fill with distinct ids (pool + synthetic that "exist")
    const ids = Array.from({ length: cap }, (_, i) => 10_000 + i);
    for (const id of ids) applyAction(l, { action: "addPlayer", teamId: a.id, playerId: id }, () => true);
    expect(() => applyAction(l, { action: "addPlayer", teamId: a.id, playerId: 20_000 }, () => true)).toThrow(/at most/);
  });
});

describe("custom snapshot + full-season projections", () => {
  async function setup(presetId = "ffl-ppr") {
    const pool = await fetchPlayerPool("football", 2026, poolClient(ffl));
    const ids = [...pool.byId.keys()];
    const league = newCustomLeague({ name: "Custom Cup", sport: "football", season: 2026, presetId });
    league.teams = [
      { id: 1, name: "Reds", playerIds: [ids[0], ids[1], ids[2]] },
      { id: 2, name: "Blues", playerIds: [ids[3], ids[4], ids[5]] },
    ];
    league.nextTeamId = 3;
    return { pool, league, ids };
  }

  it("builds a supported snapshot from the pool and preset", async () => {
    const { pool, league } = await setup();
    const snap = buildCustomSnapshot(league, pool, new Date("2026-10-29T00:00:00Z"));
    expect(snap.source).toBe("custom");
    expect(snap.format.supported).toBe(true);
    expect(snap.settings.scoringItems.length).toBeGreaterThan(0);
    expect(snap.settings.scoringLabel).toMatch(/PPR/);
    expect(snap.teams.map((t) => t.name)).toEqual(["Reds", "Blues"]);
    expect(snap.teams[0].roster.length).toBe(3);
    expect(snap.freeAgents.status).toBe("unavailable");
  });

  it("warns and skips players no longer in the pool", async () => {
    const { pool, league } = await setup();
    league.teams[0].playerIds.push(777777);
    const snap = buildCustomSnapshot(league, pool, new Date());
    expect(snap.warnings.join(" ")).toMatch(/no longer in ESPN/);
    expect(snap.teams[0].roster.some((r) => r.playerId === 777777)).toBe(false);
  });

  it("projects full-season points scored by the preset, single-period horizon", async () => {
    const { pool, league } = await setup();
    const snap = buildCustomSnapshot(league, pool, new Date());
    const proj = new FullSeasonProjectionProvider().project(snap, Object.keys(snap.players).map(Number));
    expect(proj.status).toBe("available");
    if (proj.status !== "available") return;
    expect(proj.horizon.kind).toBe("full-season");
    expect(proj.horizon.scoringPeriodIds).toEqual([0]);
    for (const id of Object.keys(snap.players)) {
      const total = proj.byPlayer[id].total;
      expect(total === null || typeof total === "number").toBe(true);
    }
  });

  it("runs a full custom trade analysis end to end", async () => {
    const { pool, league, ids } = await setup();
    const snap = buildCustomSnapshot(league, pool, new Date());
    const req = {
      snapshotFetchedAt: snap.fetchedAt,
      teamA: { teamId: 1, sends: [ids[0]], drops: [], adds: [] },
      teamB: { teamId: 2, sends: [ids[3]], drops: [], adds: [] },
    };
    const analysis = analyzeTrade(snap, req, new FullSeasonProjectionProvider());
    expect(analysis.horizon.label).toMatch(/full-season/i);
    expect(["both_improve", "one_improves", "neither_improves", "insufficient_data"]).toContain(analysis.verdict);
    expect(analysis.teams).toHaveLength(2);
  });
});

describe("presets", () => {
  it("offers presets per sport with a default", () => {
    expect(presetsForSport("football").length).toBeGreaterThanOrEqual(3);
    expect(presetsForSport("basketball").length).toBeGreaterThanOrEqual(1);
    expect(presetById(defaultPresetId("football"))?.sport).toBe("football");
  });
});
