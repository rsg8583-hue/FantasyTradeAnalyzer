import { NextResponse, type NextRequest } from "next/server";
import { hashPassword } from "@/lib/accounts/password";
import { accountStore } from "@/lib/accounts/store";
import { signupRequestSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { adoptGuestSession, allowAuthAttempt } from "@/lib/server/accounts";
import { SESSION_COOKIE, assertSameOrigin, errorResponse, noStore, readJson, setAuthCookie } from "@/lib/server/http";

/** Create an account and sign in. A guest's open custom league is saved to it. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const parsed = signupRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", parsed.error.issues[0].message);
    const { username, password } = parsed.data;
    if (!allowAuthAttempt(req, username)) throw new AppError("RATE_LIMITED", "Too many attempts. Try again in a few minutes.");

    const accounts = accountStore();
    const user = accounts.createUser(username, await hashPassword(password));
    if (!user) throw new AppError("CONFLICT", "That username is taken.");
    adoptGuestSession(req.cookies.get(SESSION_COOKIE)?.value, user);
    const res = NextResponse.json({ user: { username: user.username } }, { headers: noStore });
    setAuthCookie(res, accounts.createToken(user.id), req);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
