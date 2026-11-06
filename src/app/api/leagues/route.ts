import { NextResponse, type NextRequest } from "next/server";
import { accountStore } from "@/lib/accounts/store";
import { savedLeagueRequestSchema } from "@/lib/domain/apiSchemas";
import type { AccountResponse } from "@/lib/domain/apiTypes";
import { AppError } from "@/lib/domain/errors";
import { currentUser } from "@/lib/server/accounts";
import { assertSameOrigin, errorResponse, noStore, readJson, setSessionCookie, startSession } from "@/lib/server/http";
import { leagueState } from "@/lib/server/state";
import { sessionStore } from "@/lib/session/store";

async function parse(req: NextRequest) {
  assertSameOrigin(req);
  const user = currentUser(req);
  if (!user) throw new AppError("AUTH_REQUIRED", "Sign in to use saved leagues.");
  const parsed = savedLeagueRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid league.");
  return { user, id: parsed.data.id };
}

/** Open a saved league: it becomes the active league and replaces the current session. */
export async function POST(req: NextRequest) {
  try {
    const { user, id } = await parse(req);
    const accounts = accountStore();
    const league = accounts.getLeague(user.id, id);
    if (!league) throw new AppError("LEAGUE_NOT_FOUND", "That league is no longer saved.");
    accounts.setActiveLeague(user.id, id);
    const session = startSession(req, {
      mode: "custom",
      locator: { leagueId: "custom", sport: league.sport, season: league.season },
      credentials: null,
      customLeague: league,
      userId: user.id,
      savedLeagueId: id,
    });
    const res = NextResponse.json(leagueState(session), { headers: noStore });
    setSessionCookie(res, session, req);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

/** Permanently delete a saved league, closing it if it's open. */
export async function DELETE(req: NextRequest) {
  try {
    const { user, id } = await parse(req);
    const accounts = accountStore();
    const store = sessionStore();
    if (store.forUser(user.id)?.savedLeagueId === id) store.deleteForUser(user.id);
    accounts.deleteLeague(user.id, id);
    const body: AccountResponse = { user: { username: user.username }, leagues: accounts.listLeagues(user.id) };
    return NextResponse.json(body, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
