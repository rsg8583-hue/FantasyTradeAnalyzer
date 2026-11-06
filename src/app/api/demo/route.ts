import { NextResponse, type NextRequest } from "next/server";
import { demoRequestSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { accountStore } from "@/lib/accounts/store";
import { currentUser } from "@/lib/server/accounts";
import { assertSameOrigin, errorResponse, noStore, readJson, setSessionCookie, startSession } from "@/lib/server/http";
import { syncLeague } from "@/lib/server/leagueService";
import { leagueState } from "@/lib/server/state";

/** Starts an explicitly-labeled demo session backed by fictional fixtures. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const parsed = demoRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Choose football or basketball.");
    // Demos aren't saved; a signed-in user's saved league stays closed until reopened.
    const user = currentUser(req);
    if (user) accountStore().setActiveLeague(user.id, null);
    const session = startSession(req, {
      mode: "demo",
      locator: { leagueId: parsed.data.sport === "football" ? "900001" : "900002", sport: parsed.data.sport, season: 2026 },
      credentials: null,
      customLeague: null,
      userId: user?.id ?? null,
    });
    await syncLeague(session, { force: true });
    const res = NextResponse.json(leagueState(session), { headers: noStore });
    setSessionCookie(res, session, req);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
