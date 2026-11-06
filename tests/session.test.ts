import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/domain/errors";
import type { LeagueProvider } from "@/lib/domain/provider";
import { demoSnapshot } from "@/lib/demo/fixtures";
import { STALE_AFTER_MS, syncLeague, syncStatus } from "@/lib/server/leagueService";
import { ABSOLUTE_TTL_MS, IDLE_TTL_MS, MemorySessionStore } from "@/lib/session/store";

const creds = { espnS2: "s".repeat(30), swid: "{11111111-2222-3333-4444-555555555555}" };
const locator = { leagueId: "1", sport: "football" as const, season: 2026 };

describe("MemorySessionStore", () => {
  it("issues unguessable, unique ids and isolates sessions", () => {
    const store = new MemorySessionStore();
    const a = store.create({ mode: "espn", locator, credentials: creds, customLeague: null });
    const b = store.create({ mode: "espn", locator: { ...locator, leagueId: "2" }, credentials: null, customLeague: null });
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(43);
    const got = store.get(b.id);
    expect(got.status === "ok" && got.session.credentials).toBeNull();
  });

  it("expires idle sessions and wipes their credentials", () => {
    let t = 0;
    const store = new MemorySessionStore(() => t);
    const s = store.create({ mode: "espn", locator, credentials: creds, customLeague: null });
    t = IDLE_TTL_MS + 1;
    expect(store.get(s.id)).toEqual({ status: "expired" });
    expect(s.credentials).toBeNull();
    expect(store.get(s.id)).toEqual({ status: "expired" });
  });

  it("enforces an absolute lifetime even when active", () => {
    let t = 0;
    const store = new MemorySessionStore(() => t);
    const s = store.create({ mode: "espn", locator, credentials: creds, customLeague: null });
    for (t = 0; t < ABSOLUTE_TTL_MS; t += IDLE_TTL_MS / 2) expect(store.get(s.id).status).toBe("ok");
    t = ABSOLUTE_TTL_MS;
    expect(store.get(s.id).status).toBe("expired");
  });

  it("deletes credentials on disconnect", () => {
    const store = new MemorySessionStore();
    const s = store.create({ mode: "espn", locator, credentials: creds, customLeague: null });
    store.delete(s.id);
    expect(s.credentials).toBeNull();
    expect(store.get(s.id)).toEqual({ status: "missing" });
  });
});

describe("syncLeague", () => {
  const setup = () => {
    let t = Date.parse("2026-10-29T12:00:00Z");
    const store = new MemorySessionStore(() => t);
    const session = store.create({ mode: "espn", locator, credentials: creds, customLeague: null });
    let calls = 0;
    let fail: AppError | null = null;
    const provider: LeagueProvider = {
      id: "espn",
      fetchSnapshot: async () => {
        calls++;
        await Promise.resolve();
        if (fail) throw fail;
        return demoSnapshot("football", new Date(t));
      },
    };
    return {
      session,
      provider,
      now: () => t,
      advance: (ms: number) => (t += ms),
      calls: () => calls,
      setFail: (e: AppError | null) => (fail = e),
    };
  };

  it("deduplicates concurrent syncs into one upstream request", async () => {
    const h = setup();
    const [a, b] = await Promise.all([
      syncLeague(h.session, { force: true, provider: h.provider, now: h.now }),
      syncLeague(h.session, { force: true, provider: h.provider, now: h.now }),
    ]);
    expect(h.calls()).toBe(1);
    expect(a.snapshot).toBe(b.snapshot);
  });

  it("serves recent snapshots from cache for polling", async () => {
    const h = setup();
    await syncLeague(h.session, { force: true, provider: h.provider, now: h.now });
    h.advance(30_000);
    const r = await syncLeague(h.session, { force: false, provider: h.provider, now: h.now });
    expect(r.servedFromCache).toBe(true);
    expect(h.calls()).toBe(1);
    h.advance(31_000);
    await syncLeague(h.session, { force: false, provider: h.provider, now: h.now });
    expect(h.calls()).toBe(2);
  });

  it("keeps the last good snapshot when a refresh fails and marks it stale", async () => {
    const h = setup();
    const first = await syncLeague(h.session, { force: true, provider: h.provider, now: h.now });
    h.advance(20_000);
    h.setFail(new AppError("UPSTREAM_UNAVAILABLE", "ESPN is unavailable (HTTP 503)."));
    const second = await syncLeague(h.session, { force: true, provider: h.provider, now: h.now });
    expect(second.error?.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(second.snapshot).toBe(first.snapshot);
    const status = syncStatus(h.session, h.now());
    expect(status.stale).toBe(true);
    expect(status.lastSuccessAt).toBe(first.snapshot!.fetchedAt);
  });

  it("flags expired ESPN credentials so the UI can ask to reconnect", async () => {
    const h = setup();
    await syncLeague(h.session, { force: true, provider: h.provider, now: h.now });
    h.advance(20_000);
    h.setFail(new AppError("AUTH_INVALID", "ESPN rejected your cookies."));
    await syncLeague(h.session, { force: true, provider: h.provider, now: h.now });
    expect(syncStatus(h.session, h.now()).credentialsRejected).toBe(true);
  });

  it("labels data stale after a long time without a successful sync", async () => {
    const h = setup();
    await syncLeague(h.session, { force: true, provider: h.provider, now: h.now });
    expect(syncStatus(h.session, h.now()).stale).toBe(false);
    expect(syncStatus(h.session, h.now() + STALE_AFTER_MS + 1).stale).toBe(true);
  });

  it("rate limits upstream syncs per session", async () => {
    const h = setup();
    for (let i = 0; i < 20; i++) {
      await syncLeague(h.session, { force: true, provider: h.provider, now: h.now });
      h.advance(16_000);
    }
    const r = await syncLeague(h.session, { force: true, provider: h.provider, now: h.now });
    expect(r.error?.code).toBe("RATE_LIMITED");
    expect(r.snapshot).not.toBeNull();
  });
});
