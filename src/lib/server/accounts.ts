import "server-only";
import type { NextRequest } from "next/server";
import { accountStore, type AccountStore, type AccountUser } from "@/lib/accounts/store";
import { sessionStore, type SessionData, type SessionStore } from "@/lib/session/store";

export const AUTH_COOKIE = "fta_auth";

export function currentUser(req: NextRequest, accounts: AccountStore = accountStore()): AccountUser | null {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  return token ? accounts.userForToken(token) : null;
}

/**
 * The signed-in user's live session, or a new one rebuilt from their active
 * saved league (after a restart or idle expiry). The snapshot is re-fetched on
 * the next sync.
 */
export function restoreUserSession(userId: number, store: SessionStore = sessionStore(), accounts: AccountStore = accountStore()): SessionData | null {
  const live = store.forUser(userId);
  if (live) return live;
  const active = accounts.activeLeague(userId);
  if (!active) return null;
  const { league } = active;
  return store.create({
    mode: "custom",
    locator: { leagueId: "custom", sport: league.sport, season: league.season },
    credentials: null,
    customLeague: league,
    userId,
    savedLeagueId: active.id,
  });
}

/** Writes the session's custom league back to the owner's saved copy. No-op for guests. */
export function persistLeague(session: SessionData, accounts: AccountStore = accountStore()): void {
  if (session.userId === null || session.savedLeagueId === null || !session.customLeague) return;
  accounts.updateLeague(session.userId, session.savedLeagueId, session.customLeague);
}

/**
 * Called right after sign-in. A guest's custom league is saved to the account
 * and becomes its active league; any other guest session (a demo) is just
 * handed to the user. The user's sessions on other devices are replaced.
 */
export function adoptGuestSession(sessionId: string | undefined, user: AccountUser, store: SessionStore = sessionStore(), accounts: AccountStore = accountStore()): void {
  const found = sessionId ? store.get(sessionId) : null;
  if (found?.status !== "ok" || found.session.userId !== null) return;
  const s = found.session;
  store.deleteForUser(user.id);
  s.userId = user.id;
  if (s.mode === "custom" && s.customLeague) {
    s.savedLeagueId = accounts.createLeague(user.id, s.customLeague);
    accounts.setActiveLeague(user.id, s.savedLeagueId);
  }
}

const AUTH_WINDOW_MS = 15 * 60_000;
/** Per username it's tight; per address it's looser, since people share networks. */
const AUTH_MAX = { ip: 30, user: 10 };
const attempts = new Map<string, number[]>();

/**
 * Sliding-window limit on sign-in and sign-up attempts, per client address and
 * per username, to slow password guessing. In memory, like sessions.
 */
export function allowAuthAttempt(req: NextRequest, username: string, now = Date.now()): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const keys = [`ip:${ip}`, `user:${username.toLowerCase()}`];
  const limits = [AUTH_MAX.ip, AUTH_MAX.user];
  const logs = keys.map((k) => (attempts.get(k) ?? []).filter((t) => now - t < AUTH_WINDOW_MS));
  if (attempts.size > 10_000) attempts.clear();
  const allowed = logs.every((l, i) => l.length < limits[i]);
  keys.forEach((k, i) => attempts.set(k, allowed ? [...logs[i], now] : logs[i]));
  return allowed;
}
