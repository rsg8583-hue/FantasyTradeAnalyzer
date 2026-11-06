import { NextResponse, type NextRequest } from "next/server";
import { decoyHash, verifyPassword } from "@/lib/accounts/password";
import { accountStore } from "@/lib/accounts/store";
import { loginRequestSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { adoptGuestSession, allowAuthAttempt } from "@/lib/server/accounts";
import { SESSION_COOKIE, assertSameOrigin, errorResponse, noStore, readJson, setAuthCookie } from "@/lib/server/http";

/** Sign in. A guest's open custom league is saved to the account. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const parsed = loginRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", parsed.error.issues[0].message);
    const { username, password } = parsed.data;
    if (!allowAuthAttempt(req, username)) throw new AppError("RATE_LIMITED", "Too many attempts. Try again in a few minutes.");

    const accounts = await accountStore();
    const found = await accounts.findUser(username);
    // Verify against a decoy for unknown names so response time doesn't reveal which usernames exist.
    const ok = await verifyPassword(password, found?.passwordHash ?? (await decoyHash()));
    if (!found || !ok) throw new AppError("AUTH_INVALID", "Incorrect username or password.");

    const user = { id: found.id, username: found.username };
    await adoptGuestSession(req.cookies.get(SESSION_COOKIE)?.value, user, accounts);
    const res = NextResponse.json({ user: { username: user.username } }, { headers: noStore });
    setAuthCookie(res, await accounts.createToken(user.id), req);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
