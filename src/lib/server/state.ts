import "server-only";
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
  return session.userId !== null && session.username !== null ? { username: session.username, saved: session.savedLeagueId !== null } : null;
}
