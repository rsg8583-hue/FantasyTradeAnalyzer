import "server-only";
import { accountStore } from "@/lib/accounts/store";
import type { SessionData } from "@/lib/session/store";
import { syncStatus } from "./leagueService";
import type { LeagueStateResponse } from "@/lib/domain/apiTypes";

/** Client-safe view of a session. Never includes credentials. */
export function leagueState(session: SessionData): LeagueStateResponse {
  return {
    connected: true,
    mode: session.mode,
    locator: session.locator,
    hasCredentials: session.credentials !== null,
    expiresAt: new Date(session.expiresAt).toISOString(),
    snapshot: session.snapshot,
    sync: syncStatus(session),
    customLeague: session.customLeague,
    account: accountFor(session),
  };
}

function accountFor(session: SessionData): LeagueStateResponse["account"] {
  if (session.userId === null) return null;
  const user = accountStore().userById(session.userId);
  return user ? { username: user.username, saved: session.savedLeagueId !== null } : null;
}
