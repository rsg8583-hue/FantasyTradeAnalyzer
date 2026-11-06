import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/domain/errors";
import { EspnClient, assertAllowedUrl, buildEspnUrl, type EspnRequestContext } from "@/lib/espn/client";
import { parseLeagueInput } from "@/lib/espn/leagueInput";
import { detectFormat, extractProjections, normalizeProSchedule, normalizeSettings } from "@/lib/espn/normalize";
import { EspnLeagueProvider } from "@/lib/espn/provider";
import { rawLeagueSettingsResponseSchema, rawProScheduleResponseSchema } from "@/lib/espn/schemas";
import realSchedule from "./fixtures/espn-ffl-pro-schedule-2026.trimmed.json";
import { SnapshotProjectionProvider } from "@/lib/projections/snapshotProvider";
import { freeAgentsResponse, proScheduleResponse, settingsResponse, teamsResponse } from "./fixtures/espn";

const creds = { espnS2: "AEB" + "x".repeat(40), swid: "{11111111-2222-3333-4444-555555555555}" };
const ctx = (withCreds = true): EspnRequestContext => ({ sport: "football", season: 2026, leagueId: "12345", credentials: withCreds ? creds : null });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Routes mocked fetch calls by ESPN view. */
function mockEspn(overrides: Partial<Record<string, () => Response | Promise<Response>>> = {}) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const views = url.searchParams.getAll("view").join(",");
    const handler = overrides[views];
    if (handler) return handler();
    if (views === "mSettings") return json(settingsResponse());
    if (views === "mTeam,mRoster") return json(teamsResponse());
    if (views === "kona_player_info") return json(freeAgentsResponse());
    if (views === "proTeamSchedules_wl") return json(proScheduleResponse());
    return json({}, 404);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const noSleep = async () => {};

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await p.catch((e: AppError) => expect(e.code).toBe(code));
}

describe("league input parsing", () => {
  it("accepts a bare id", () => {
    expect(parseLeagueInput(" 123456 ")).toEqual({ leagueId: "123456", sportHint: null, seasonHint: null });
  });
  it("extracts id, sport and season from an ESPN URL without fetching it", () => {
    expect(parseLeagueInput("https://fantasy.espn.com/football/league?leagueId=987&seasonId=2026")).toEqual({
      leagueId: "987",
      sportHint: "football",
      seasonHint: 2026,
    });
  });
  it("rejects non-ESPN hosts and malformed ids", () => {
    expect(parseLeagueInput("https://evil.example.com/football/league?leagueId=1")).toHaveProperty("error");
    expect(parseLeagueInput("https://fantasy.espn.com/football/league?leagueId=abc")).toHaveProperty("error");
    expect(parseLeagueInput("javascript:alert(1)")).toHaveProperty("error");
  });
});

describe("endpoint allowlist", () => {
  it("builds the verified league endpoint", () => {
    const url = buildEspnUrl(ctx(), { kind: "league", views: ["mSettings"] });
    expect(url.toString()).toBe("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/12345?view=mSettings");
  });
  it("rejects non-numeric league ids, unknown views and foreign hosts", () => {
    expect(() => buildEspnUrl({ ...ctx(), leagueId: "1/../../x" }, { kind: "league", views: [] })).toThrow(AppError);
    expect(() => buildEspnUrl(ctx(), { kind: "league", views: ["mTransactions2"] })).toThrow(/not allowed/);
    expect(() => assertAllowedUrl(new URL("https://example.com/apis/v3/games/ffl/seasons/2026"))).toThrow(AppError);
    expect(() => assertAllowedUrl(new URL("http://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026"))).toThrow(AppError);
  });
});

describe("EspnClient", () => {
  it("sends cookies only in the Cookie header of league requests", async () => {
    const { fetchImpl, calls } = mockEspn();
    const client = new EspnClient({ fetchImpl, sleep: noSleep });
    await client.get(ctx(), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema);
    expect(calls[0].headers.Cookie).toBe(`espn_s2=${creds.espnS2}; SWID=${creds.swid}`);
    expect(calls[0].url.toString()).not.toContain(creds.espnS2);
  });

  it("maps 401 without cookies to AUTH_REQUIRED and with cookies to AUTH_INVALID (expired)", async () => {
    const { fetchImpl } = mockEspn({ mSettings: () => json({ messages: ["not authorized"] }, 401) });
    const client = new EspnClient({ fetchImpl, sleep: noSleep });
    await expectCode(client.get(ctx(false), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "AUTH_REQUIRED");
    await expectCode(client.get(ctx(true), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "AUTH_INVALID");
  });

  it("treats a redirect (e.g. to a login page) as an auth failure", async () => {
    const { fetchImpl } = mockEspn({ mSettings: () => new Response(null, { status: 302, headers: { location: "https://espn.com/login" } }) });
    const client = new EspnClient({ fetchImpl, sleep: noSleep });
    await expectCode(client.get(ctx(true), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "AUTH_INVALID");
  });

  it("retries transient failures a bounded number of times", async () => {
    let n = 0;
    const { fetchImpl } = mockEspn({ mSettings: () => (++n < 3 ? json({}, 503) : json(settingsResponse())) });
    const client = new EspnClient({ fetchImpl, sleep: noSleep, maxRetries: 2 });
    await client.get(ctx(), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema);
    expect(n).toBe(3);

    let m = 0;
    const { fetchImpl: alwaysDown } = mockEspn({ mSettings: () => (m++, json({}, 503)) });
    const c2 = new EspnClient({ fetchImpl: alwaysDown, sleep: noSleep, maxRetries: 2 });
    await expectCode(c2.get(ctx(), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "UPSTREAM_UNAVAILABLE");
    expect(m).toBe(3);
  });

  it("maps ESPN's 400 for an unparseable league id to not-found", async () => {
    const { fetchImpl } = mockEspn({ mSettings: () => json({ messages: ["Invalid parameter for 'leagueId'."] }, 400) });
    const client = new EspnClient({ fetchImpl, sleep: noSleep });
    await expectCode(client.get(ctx(), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "LEAGUE_NOT_FOUND");
  });

  it("does not retry 404s", async () => {
    let n = 0;
    const { fetchImpl } = mockEspn({ mSettings: () => (n++, json({}, 404)) });
    const client = new EspnClient({ fetchImpl, sleep: noSleep });
    await expectCode(client.get(ctx(), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "LEAGUE_NOT_FOUND");
    expect(n).toBe(1);
  });

  it("times out slow responses", async () => {
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const client = new EspnClient({ fetchImpl, timeoutMs: 5, maxRetries: 0, sleep: noSleep });
    await expectCode(client.get(ctx(), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "UPSTREAM_TIMEOUT");
  });

  it("rejects non-JSON and unexpectedly-shaped responses", async () => {
    const html = mockEspn({ mSettings: () => new Response("<html>login</html>", { status: 200 }) });
    await expectCode(new EspnClient({ fetchImpl: html.fetchImpl, sleep: noSleep }).get(ctx(), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "UPSTREAM_MALFORMED");
    const shape = mockEspn({ mSettings: () => json({ messages: ["error"] }) });
    await expectCode(new EspnClient({ fetchImpl: shape.fetchImpl, sleep: noSleep }).get(ctx(), { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema), "UPSTREAM_MALFORMED");
  });
});

describe("normalization", () => {
  const raw = rawLeagueSettingsResponseSchema.parse(settingsResponse());

  it("normalizes slots, limits and scoring", () => {
    const { settings, warnings } = normalizeSettings(raw, "football", 2026, "12345");
    expect(settings.slots.map((s) => `${s.name}:${s.count}:${s.kind}`)).toEqual(["QB:1:starter", "RB:1:starter", "WR:1:starter", "BE:2:bench", "IR:1:ir", "FLEX:1:starter"]);
    expect(settings.activeRosterLimit).toBe(6);
    expect(settings.irSlotCount).toBe(1);
    expect(settings.scoringItems[1]).toEqual({ statId: 42, points: 0.1, pointsOverrides: {} });
    expect(settings.currentScoringPeriod).toBe(9);
    expect(warnings).toEqual([]);
  });

  it("supports redraft H2H points leagues", () => {
    const { settings } = normalizeSettings(raw, "football", 2026, "1");
    expect(detectFormat(settings)).toEqual({ supported: true });
  });

  it("detects category, unknown and keeper/dynasty formats with explanations", () => {
    const cat = normalizeSettings(rawLeagueSettingsResponseSchema.parse(settingsResponse({ scoringType: "H2H_MOST_CATEGORIES" })), "basketball", 2026, "1").settings;
    const f1 = detectFormat(cat);
    expect(f1.supported).toBe(false);
    if (!f1.supported) expect(f1.reasons[0]).toMatch(/categor/i);

    const keeper = normalizeSettings(rawLeagueSettingsResponseSchema.parse(settingsResponse({ keeperCount: 3 })), "football", 2026, "1").settings;
    const f2 = detectFormat(keeper);
    expect(f2.supported).toBe(false);
    if (!f2.supported) expect(f2.reasons[0]).toMatch(/keeper or dynasty/);

    const odd = normalizeSettings(rawLeagueSettingsResponseSchema.parse(settingsResponse({ scoringType: "TOTAL_POINTS" })), "football", 2026, "1").settings;
    expect(detectFormat(odd).supported).toBe(false);
  });

  it("parses a captured (trimmed) real ESPN pro schedule, keeping bye weeks as zero games", () => {
    const raw = rawProScheduleResponseSchema.parse(realSchedule);
    const sched = normalizeProSchedule(raw);
    expect(sched.gamesByTeam["12"]["1"]).toBe(1); // KC week 1
    expect(sched.gamesByTeam["12"]["5"]).toBeUndefined(); // KC bye in week 5
    expect(sched.gamesByTeam["2"]["7"]).toBeUndefined(); // BUF bye in week 7
  });

  it("extracts only projected splits for the selected season", () => {
    const p = extractProjections(
      [
        { seasonId: 2026, scoringPeriodId: 9, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 12 },
        { seasonId: 2026, scoringPeriodId: 9, statSourceId: 0, statSplitTypeId: 1, appliedTotal: 3 },
        { seasonId: 2026, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 200, appliedAverage: 11.8 },
        { seasonId: 2025, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 999 },
      ],
      2026,
    );
    expect(p.byScoringPeriod["9"].appliedTotal).toBe(12);
    expect(p.season?.appliedTotal).toBe(200);
    expect(p.season?.appliedAverage).toBe(11.8);
  });
});

describe("EspnLeagueProvider", () => {
  it("builds a complete snapshot from mocked ESPN responses", async () => {
    const { fetchImpl, calls } = mockEspn();
    const provider = new EspnLeagueProvider(creds, new EspnClient({ fetchImpl, sleep: noSleep }), () => new Date("2026-10-29T12:00:00Z"));
    const snap = await provider.fetchSnapshot({ leagueId: "12345", sport: "football", season: 2026 });
    expect(snap.settings.name).toBe("Mock League");
    expect(snap.teams.map((t) => t.name)).toEqual(["Team One", "Team Two"]);
    expect(snap.players["11"].position).toBe("QB");
    expect(snap.players["21"].position).toBe("WR");
    expect(snap.freeAgents).toEqual({ status: "available", value: [31] });
    expect(snap.format.supported).toBe(true);
    // Roster request is pinned to the current scoring period.
    expect(calls.find((c) => c.url.searchParams.getAll("view").includes("mRoster"))?.url.searchParams.get("scoringPeriodId")).toBe("9");
    // Free-agent request uses the filter header; schedule request carries no cookies.
    expect(JSON.parse(calls.find((c) => c.url.searchParams.get("view") === "kona_player_info")!.headers["x-fantasy-filter"]).players.filterStatus.value).toEqual(["FREEAGENT", "WAIVERS"]);
    expect(calls.find((c) => c.url.searchParams.get("view") === "proTeamSchedules_wl")!.headers.Cookie).toBeUndefined();

    const proj = new SnapshotProjectionProvider().project(snap, [11, 21]);
    if (proj.status !== "available") throw new Error("expected projections");
    expect(proj.byPlayer["11"].total).toBe(18.4);
    // Player 21's team (3) has no week-9 game and no projection → known bye, scored 0.
    expect(proj.byPlayer["21"].total).toBe(0);
  });

  it("marks optional data unavailable (not empty) when its request fails", async () => {
    const { fetchImpl } = mockEspn({ kona_player_info: () => json({}, 500), proTeamSchedules_wl: () => json({ bad: true }) });
    const provider = new EspnLeagueProvider(creds, new EspnClient({ fetchImpl, sleep: noSleep, maxRetries: 0 }));
    const snap = await provider.fetchSnapshot({ leagueId: "12345", sport: "football", season: 2026 });
    expect(snap.freeAgents.status).toBe("unavailable");
    expect(snap.proSchedule.status).toBe("unavailable");
    expect(snap.teams).toHaveLength(2);
  });

  it("propagates expired credentials as an auth error", async () => {
    const { fetchImpl } = mockEspn({ mSettings: () => json({}, 401) });
    const provider = new EspnLeagueProvider(creds, new EspnClient({ fetchImpl, sleep: noSleep }));
    await expectCode(provider.fetchSnapshot({ leagueId: "12345", sport: "football", season: 2026 }), "AUTH_INVALID");
  });
});
