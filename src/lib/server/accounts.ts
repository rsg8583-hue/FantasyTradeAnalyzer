import "server-only";
import type { NextRequest } from "next/server";
import { accountStore, type AccountStore, type AccountUser, type SavedLeague } from "@/lib/accounts/store";
import { AppError } from "@/lib/domain/errors";
import { sessionStore, type SessionData, type SessionInit, type SessionStore } from "@/lib/session/store";

export const AUTH_COOKIE = "fta_auth";

/** The signed-in user. Guests (no auth cookie) never touch the database. */
export async function currentUser(req: NextRequest, accounts?: AccountStore): Promise<AccountUser | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  return token ? (accounts ?? (await accountStore())).userForToken(token) : null;
}

/** Session fields for opening a saved league. */
export function savedSessionInit(user: AccountUser, saved: SavedLeague): SessionInit {
  const { league } = saved;
  return {
    mode: "custom",
    locator: { leagueId: "custom", sport: league.sport, season: league.season },
    credentials: null,
    customLeague: league,
    userId: user.id,
    username: user.username,
    savedLeagueId: saved.id,
    savedVersion: saved.version,
  };
}

/**
 * The signed-in user's live session, or a new one rebuilt from their active
 * saved league (after a restart, idle expiry, or on another server instance).
 * The snapshot is re-fetched on the next sync.
 */
export async function restoreUserSession(user: AccountUser, accounts: AccountStore, store: SessionStore = sessionStore()): Promise<SessionData | null> {
  const live = store.forUser(user.id);
  if (live) return live;
  const active = await accounts.activeLeague(user.id);
  return active ? store.create(savedSessionInit(user, active)) : null;
}

/**
 * Brings a signed-in session's league up to date with the saved copy, which
 * another device or server instance may have changed. Returns false if the
 * saved league was deleted.
 */
export async function refreshFromSaved(session: SessionData, accounts: AccountStore): Promise<boolean> {
  if (session.userId === null || session.savedLeagueId === null) return true;
  const saved = await accounts.getLeague(session.userId, session.savedLeagueId);
  if (!saved) return false;
  if (saved.version !== session.savedVersion) {
    session.customLeague = saved.league;
    session.savedVersion = saved.version;
    // The snapshot was built from the old league; the next sync rebuilds it.
    session.snapshot = null;
    session.sync.lastSuccessAt = null;
    session.explanations.clear();
  }
  return true;
}

/** Writes the session's custom league back to the owner's saved copy. No-op for guests. */
export async function persistLeague(session: SessionData, accounts?: AccountStore): Promise<void> {
  if (session.userId === null || session.savedLeagueId === null || session.savedVersion === null || !session.customLeague) return;
  const store = accounts ?? (await accountStore());
  const version = await store.updateLeague(session.userId, session.savedLeagueId, session.customLeague, session.savedVersion);
  if (version === null) {
    // Leave savedVersion stale so the next request reloads the saved copy.
    throw new AppError("CONFLICT", "This league was changed somewhere else, so your last edit wasn't saved. Reload to see the latest version.");
  }
  session.savedVersion = version;
}

/**
 * Called right after sign-in. A guest's custom league is saved to the account
 * and becomes its active league; any other guest session (a demo) is just
 * handed to the user. The user's sessions on other devices are replaced.
 */
export async function adoptGuestSession(sessionId: string | undefined, user: AccountUser, accounts: AccountStore, store: SessionStore = sessionStore()): Promise<void> {
  const found = sessionId ? store.get(sessionId) : null;
  if (found?.status !== "ok" || found.session.userId !== null) return;
  const s = found.session;
  store.deleteForUser(user.id);
  s.userId = user.id;
  s.username = user.username;
  if (s.mode === "custom" && s.customLeague) {
    const saved = await accounts.createLeague(user.id, s.customLeague);
    s.savedLeagueId = saved.id;
    s.savedVersion = saved.version;
    await accounts.setActiveLeague(user.id, saved.id);
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
