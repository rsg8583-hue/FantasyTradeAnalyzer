import { NextResponse, type NextRequest } from "next/server";
import { accountStore } from "@/lib/accounts/store";
import { savedLeagueRequestSchema } from "@/lib/domain/apiSchemas";
import type { AccountResponse } from "@/lib/domain/apiTypes";
import { AppError } from "@/lib/domain/errors";
import { AUTH_COOKIE, currentUser, savedSessionInit } from "@/lib/server/accounts";
import { assertSameOrigin, errorResponse, noStore, readJson, setSessionCookie, startSession } from "@/lib/server/http";
import { leagueState } from "@/lib/server/state";
import { sessionStore } from "@/lib/session/store";

async function parse(req: NextRequest) {
  assertSameOrigin(req);
  const accounts = req.cookies.has(AUTH_COOKIE) ? await accountStore() : null;
  const user = accounts ? await currentUser(req, accounts) : null;
  if (!accounts || !user) throw new AppError("AUTH_REQUIRED", "Sign in to use saved leagues.");
  const parsed = savedLeagueRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid league.");
  return { accounts, user, id: parsed.data.id };
}

/** Open a saved league: it becomes the active league and replaces the current session. */
export async function POST(req: NextRequest) {
  try {
    const { accounts, user, id } = await parse(req);
    const saved = await accounts.getLeague(user.id, id);
    if (!saved) throw new AppError("LEAGUE_NOT_FOUND", "That league is no longer saved.");
    await accounts.setActiveLeague(user.id, id);
    const session = startSession(req, savedSessionInit(user, saved));
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
    const { accounts, user, id } = await parse(req);
    const store = sessionStore();
    if (store.forUser(user.id)?.savedLeagueId === id) store.deleteForUser(user.id);
    await accounts.deleteLeague(user.id, id);
    const body: AccountResponse = { user: { username: user.username }, leagues: await accounts.listLeagues(user.id) };
    return NextResponse.json(body, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
