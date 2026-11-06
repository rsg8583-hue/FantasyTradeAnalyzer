import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/accounts/password";
import { AUTH_TTL_MS, AccountStore } from "@/lib/accounts/store";
import { newCustomLeague } from "@/lib/custom/mutate";
import { adoptGuestSession, persistLeague, refreshFromSaved, restoreUserSession, savedSessionInit } from "@/lib/server/accounts";
import { MemorySessionStore } from "@/lib/session/store";

const league = (name = "My League") => newCustomLeague({ name, sport: "football", season: 2026, presetId: "ffl-ppr" });
const locator = { leagueId: "custom", sport: "football" as const, season: 2026 };

function setup() {
  let t = Date.parse("2026-11-06T12:00:00Z");
  const accounts = new AccountStore(createClient({ url: ":memory:" }), () => t);
  return { accounts, advance: (ms: number) => (t += ms) };
}

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
    expect(await verifyPassword("correct horse", "garbage")).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("AccountStore", () => {
  it("rejects duplicate usernames regardless of case", async () => {
    const { accounts } = setup();
    expect(await accounts.createUser("Ryan", "h")).not.toBeNull();
    expect(await accounts.createUser("ryan", "h")).toBeNull();
    expect((await accounts.findUser("RYAN"))?.username).toBe("Ryan");
  });

  it("resolves login tokens until they expire or are deleted", async () => {
    const { accounts, advance } = setup();
    const user = (await accounts.createUser("a", "h"))!;
    const token = await accounts.createToken(user.id);
    expect(await accounts.userForToken(token)).toEqual(user);
    expect(await accounts.userForToken(token + "x")).toBeNull();
    await accounts.deleteToken(token);
    expect(await accounts.userForToken(token)).toBeNull();

    const t2 = await accounts.createToken(user.id);
    advance(AUTH_TTL_MS);
    expect(await accounts.userForToken(t2)).toBeNull();
  });

  it("scopes leagues to their owner", async () => {
    const { accounts } = setup();
    const a = (await accounts.createUser("a", "h"))!;
    const b = (await accounts.createUser("b", "h"))!;
    const { id } = await accounts.createLeague(a.id, league("A's league"));
    expect(await accounts.getLeague(b.id, id)).toBeNull();
    expect(await accounts.updateLeague(b.id, id, league("hijacked"), 1)).toBeNull();
    await accounts.deleteLeague(b.id, id);
    expect((await accounts.getLeague(a.id, id))?.league.name).toBe("A's league");
    expect(await accounts.listLeagues(b.id)).toEqual([]);
  });

  it("only saves over the version it was loaded from", async () => {
    const { accounts } = setup();
    const u = (await accounts.createUser("a", "h"))!;
    const { id, version } = await accounts.createLeague(u.id, league());
    expect(await accounts.updateLeague(u.id, id, league("first"), version)).toBe(2);
    // A second copy still at version 1 can't overwrite the newer save.
    expect(await accounts.updateLeague(u.id, id, league("stale"), version)).toBeNull();
    expect(await accounts.getLeague(u.id, id)).toMatchObject({ version: 2, league: { name: "first" } });
  });

  it("tracks and clears the active league", async () => {
    const { accounts } = setup();
    const u = (await accounts.createUser("a", "h"))!;
    const { id } = await accounts.createLeague(u.id, league());
    await accounts.setActiveLeague(u.id, id);
    expect((await accounts.activeLeague(u.id))?.id).toBe(id);
    expect((await accounts.listLeagues(u.id))[0]).toMatchObject({ id, name: "My League", teamCount: 0, active: true });
    await accounts.deleteLeague(u.id, id);
    expect(await accounts.activeLeague(u.id)).toBeNull();
  });
});

describe("user sessions", () => {
  it("restores the active saved league after the in-memory session is gone", async () => {
    const { accounts } = setup();
    const store = new MemorySessionStore();
    const u = (await accounts.createUser("a", "h"))!;
    expect(await restoreUserSession(u, accounts, store)).toBeNull();

    const saved = league();
    saved.teams.push({ id: 1, name: "Team 1", playerIds: [-16014] });
    const { id } = await accounts.createLeague(u.id, saved);
    await accounts.setActiveLeague(u.id, id);

    const s = (await restoreUserSession(u, accounts, store))!;
    expect(s).toMatchObject({ mode: "custom", userId: u.id, username: "a", savedLeagueId: id, savedVersion: 1, snapshot: null });
    expect(s.customLeague?.teams[0].playerIds).toEqual([-16014]);
    // The same live session is reused rather than rebuilt.
    expect(await restoreUserSession(u, accounts, store)).toBe(s);
  });

  it("writes edits back to the saved league", async () => {
    const { accounts } = setup();
    const store = new MemorySessionStore();
    const u = (await accounts.createUser("a", "h"))!;
    const s = store.create(savedSessionInit(u, await accounts.createLeague(u.id, league())));
    s.customLeague!.teams.push({ id: 1, name: "Added", playerIds: [] });
    await persistLeague(s, accounts);
    expect(s.savedVersion).toBe(2);
    expect((await accounts.getLeague(u.id, s.savedLeagueId!))?.league.teams.map((t) => t.name)).toEqual(["Added"]);
  });

  it("picks up edits made by another server instance instead of overwriting them", async () => {
    const { accounts } = setup();
    const u = (await accounts.createUser("a", "h"))!;
    const saved = await accounts.createLeague(u.id, league());
    // Two instances, each with its own in-memory copy.
    const a = new MemorySessionStore().create(savedSessionInit(u, saved));
    const b = new MemorySessionStore().create(savedSessionInit(u, saved));

    a.customLeague!.teams.push({ id: 1, name: "From A", playerIds: [] });
    await persistLeague(a, accounts);

    b.customLeague!.teams.push({ id: 1, name: "From B (stale)", playerIds: [] });
    await expect(persistLeague(b, accounts)).rejects.toThrow(/changed somewhere else/);
    expect(await refreshFromSaved(b, accounts)).toBe(true);
    expect(b.customLeague?.teams.map((t) => t.name)).toEqual(["From A"]);
    expect(b.snapshot).toBeNull();

    await accounts.deleteLeague(u.id, saved.id);
    expect(await refreshFromSaved(b, accounts)).toBe(false);
  });

  it("saves a guest's league to the account on sign-in", async () => {
    const { accounts } = setup();
    const store = new MemorySessionStore();
    const u = (await accounts.createUser("a", "h"))!;
    const other = store.create({ mode: "demo", locator, credentials: null, customLeague: null, userId: u.id });
    const guest = store.create({ mode: "custom", locator, credentials: null, customLeague: league("Guest league") });

    await adoptGuestSession(guest.id, u, accounts, store);
    expect(guest).toMatchObject({ userId: u.id, username: "a", savedVersion: 1 });
    expect(await accounts.activeLeague(u.id)).toEqual({ id: guest.savedLeagueId, league: guest.customLeague, version: 1 });
    // The user's previous session elsewhere is replaced.
    expect(store.get(other.id).status).toBe("missing");
    expect(store.forUser(u.id)).toBe(guest);
  });

  it("never adopts a session that already belongs to someone", async () => {
    const { accounts } = setup();
    const store = new MemorySessionStore();
    const a = (await accounts.createUser("a", "h"))!;
    const b = (await accounts.createUser("b", "h"))!;
    const owned = store.create({ mode: "custom", locator, credentials: null, customLeague: league(), userId: a.id });
    await adoptGuestSession(owned.id, b, accounts, store);
    expect(owned.userId).toBe(a.id);
    expect(await accounts.listLeagues(b.id)).toEqual([]);
  });
});
