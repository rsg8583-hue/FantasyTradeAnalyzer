import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/accounts/password";
import { AUTH_TTL_MS, AccountStore } from "@/lib/accounts/store";
import { newCustomLeague } from "@/lib/custom/mutate";
import { adoptGuestSession, persistLeague, restoreUserSession } from "@/lib/server/accounts";
import { MemorySessionStore } from "@/lib/session/store";

const league = (name = "My League") => newCustomLeague({ name, sport: "football", season: 2026, presetId: "ffl-ppr" });
const locator = { leagueId: "custom", sport: "football" as const, season: 2026 };

function setup() {
  let t = Date.parse("2026-11-06T12:00:00Z");
  const accounts = new AccountStore(new Database(":memory:"), () => t);
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
  it("rejects duplicate usernames regardless of case", () => {
    const { accounts } = setup();
    expect(accounts.createUser("Ryan", "h")).not.toBeNull();
    expect(accounts.createUser("ryan", "h")).toBeNull();
    expect(accounts.findUser("RYAN")?.username).toBe("Ryan");
  });

  it("resolves login tokens until they expire or are deleted", () => {
    const { accounts, advance } = setup();
    const user = accounts.createUser("a", "h")!;
    const token = accounts.createToken(user.id);
    expect(accounts.userForToken(token)).toEqual(user);
    expect(accounts.userForToken(token + "x")).toBeNull();
    accounts.deleteToken(token);
    expect(accounts.userForToken(token)).toBeNull();

    const t2 = accounts.createToken(user.id);
    advance(AUTH_TTL_MS);
    expect(accounts.userForToken(t2)).toBeNull();
  });

  it("scopes leagues to their owner", () => {
    const { accounts } = setup();
    const a = accounts.createUser("a", "h")!;
    const b = accounts.createUser("b", "h")!;
    const id = accounts.createLeague(a.id, league("A's league"));
    expect(accounts.getLeague(b.id, id)).toBeNull();
    accounts.updateLeague(b.id, id, league("hijacked"));
    accounts.deleteLeague(b.id, id);
    expect(accounts.getLeague(a.id, id)?.name).toBe("A's league");
    expect(accounts.listLeagues(b.id)).toEqual([]);
  });

  it("tracks and clears the active league", () => {
    const { accounts } = setup();
    const u = accounts.createUser("a", "h")!;
    const id = accounts.createLeague(u.id, league());
    accounts.setActiveLeague(u.id, id);
    expect(accounts.activeLeague(u.id)?.id).toBe(id);
    expect(accounts.listLeagues(u.id)[0]).toMatchObject({ id, name: "My League", teamCount: 0, active: true });
    accounts.deleteLeague(u.id, id);
    expect(accounts.activeLeague(u.id)).toBeNull();
  });
});

describe("user sessions", () => {
  it("restores the active saved league after the in-memory session is gone", () => {
    const { accounts } = setup();
    const store = new MemorySessionStore();
    const u = accounts.createUser("a", "h")!;
    expect(restoreUserSession(u.id, store, accounts)).toBeNull();

    const saved = league();
    saved.teams.push({ id: 1, name: "Team 1", playerIds: [-16014] });
    const id = accounts.createLeague(u.id, saved);
    accounts.setActiveLeague(u.id, id);

    const s = restoreUserSession(u.id, store, accounts)!;
    expect(s).toMatchObject({ mode: "custom", userId: u.id, savedLeagueId: id, snapshot: null });
    expect(s.customLeague?.teams[0].playerIds).toEqual([-16014]);
    // The same live session is reused rather than rebuilt.
    expect(restoreUserSession(u.id, store, accounts)).toBe(s);
  });

  it("writes edits back to the saved league", () => {
    const { accounts } = setup();
    const store = new MemorySessionStore();
    const u = accounts.createUser("a", "h")!;
    const id = accounts.createLeague(u.id, league());
    const s = store.create({ mode: "custom", locator, credentials: null, customLeague: league(), userId: u.id, savedLeagueId: id });
    s.customLeague!.teams.push({ id: 1, name: "Added", playerIds: [] });
    persistLeague(s, accounts);
    expect(accounts.getLeague(u.id, id)?.teams.map((t) => t.name)).toEqual(["Added"]);
  });

  it("saves a guest's league to the account on sign-in", () => {
    const { accounts } = setup();
    const store = new MemorySessionStore();
    const u = accounts.createUser("a", "h")!;
    const other = store.create({ mode: "demo", locator, credentials: null, customLeague: null, userId: u.id });
    const guest = store.create({ mode: "custom", locator, credentials: null, customLeague: league("Guest league") });

    adoptGuestSession(guest.id, u, store, accounts);
    expect(guest.userId).toBe(u.id);
    expect(accounts.activeLeague(u.id)).toEqual({ id: guest.savedLeagueId, league: guest.customLeague });
    // The user's previous session elsewhere is replaced.
    expect(store.get(other.id).status).toBe("missing");
    expect(store.forUser(u.id)).toBe(guest);
  });

  it("never adopts a session that already belongs to someone", () => {
    const { accounts } = setup();
    const store = new MemorySessionStore();
    const a = accounts.createUser("a", "h")!;
    const b = accounts.createUser("b", "h")!;
    const owned = store.create({ mode: "custom", locator, credentials: null, customLeague: league(), userId: a.id });
    adoptGuestSession(owned.id, b, store, accounts);
    expect(owned.userId).toBe(a.id);
    expect(accounts.listLeagues(b.id)).toEqual([]);
  });
});
