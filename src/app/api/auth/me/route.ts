import { NextResponse, type NextRequest } from "next/server";
import { accountStore } from "@/lib/accounts/store";
import type { AccountResponse } from "@/lib/domain/apiTypes";
import { AUTH_COOKIE, currentUser } from "@/lib/server/accounts";
import { errorResponse, noStore } from "@/lib/server/http";

/** The signed-in user and their saved leagues, or `user: null` for a guest. */
export async function GET(req: NextRequest) {
  try {
    let body: AccountResponse = { user: null, leagues: [] };
    if (req.cookies.has(AUTH_COOKIE)) {
      const accounts = await accountStore();
      const user = await currentUser(req, accounts);
      if (user) body = { user: { username: user.username }, leagues: await accounts.listLeagues(user.id) };
    }
    return NextResponse.json(body, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
