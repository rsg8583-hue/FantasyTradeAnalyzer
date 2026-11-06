import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, assertSameOrigin, clearSessionCookie, errorResponse, noStore, requireSession } from "@/lib/server/http";
import { leagueState } from "@/lib/server/state";
import { sessionStore } from "@/lib/session/store";
import { accountStore } from "@/lib/accounts/store";
import { currentUser } from "@/lib/server/accounts";

/** Current session state without contacting ESPN. */
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(leagueState(requireSession(req)), { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Disconnect: deletes the server-side session, including stored credentials.
 * A signed-in user's league stays saved; it's just no longer reopened automatically.
 */
export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const id = req.cookies.get(SESSION_COOKIE)?.value;
    if (id) sessionStore().delete(id);
    const user = currentUser(req);
    if (user) {
      sessionStore().deleteForUser(user.id);
      accountStore().setActiveLeague(user.id, null);
    }
    const res = NextResponse.json({ connected: false }, { headers: noStore });
    clearSessionCookie(res);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
