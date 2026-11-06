import { NextResponse, type NextRequest } from "next/server";
import { accountStore } from "@/lib/accounts/store";
import type { AccountResponse } from "@/lib/domain/apiTypes";
import { currentUser } from "@/lib/server/accounts";
import { errorResponse, noStore } from "@/lib/server/http";

/** The signed-in user and their saved leagues, or `user: null` for a guest. */
export async function GET(req: NextRequest) {
  try {
    const user = currentUser(req);
    const body: AccountResponse = user ? { user: { username: user.username }, leagues: accountStore().listLeagues(user.id) } : { user: null, leagues: [] };
    return NextResponse.json(body, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
