import { NextResponse, type NextRequest } from "next/server";
import { accountStore } from "@/lib/accounts/store";
import { AUTH_COOKIE, currentUser } from "@/lib/server/accounts";
import { SESSION_COOKIE, assertSameOrigin, clearAuthCookie, clearSessionCookie, errorResponse, noStore } from "@/lib/server/http";
import { sessionStore } from "@/lib/session/store";

/** Sign out on this device. Saved leagues stay in the account. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const store = sessionStore();
    const sid = req.cookies.get(SESSION_COOKIE)?.value;
    if (sid) store.delete(sid);
    const token = req.cookies.get(AUTH_COOKIE)?.value;
    if (token) {
      const accounts = await accountStore();
      const user = await currentUser(req, accounts);
      if (user) store.deleteForUser(user.id);
      await accounts.deleteToken(token);
    }
    const res = NextResponse.json({ user: null }, { headers: noStore });
    clearAuthCookie(res);
    clearSessionCookie(res);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
