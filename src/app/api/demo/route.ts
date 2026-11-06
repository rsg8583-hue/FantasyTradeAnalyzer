import { NextResponse, type NextRequest } from "next/server";
import { demoRequestSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { SESSION_COOKIE, assertSameOrigin, errorResponse, noStore, readJson, setSessionCookie } from "@/lib/server/http";
import { syncLeague } from "@/lib/server/leagueService";
import { leagueState } from "@/lib/server/state";
import { sessionStore } from "@/lib/session/store";

/** Starts an explicitly-labeled demo session backed by fictional fixtures. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const parsed = demoRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Choose football or basketball.");
    const store = sessionStore();
    const previous = req.cookies.get(SESSION_COOKIE)?.value;
    if (previous) store.delete(previous);
    const session = store.create({
      mode: "demo",
      locator: { leagueId: parsed.data.sport === "football" ? "900001" : "900002", sport: parsed.data.sport, season: 2026 },
      credentials: null,
      customLeague: null,
    });
    await syncLeague(session, { force: true });
    const res = NextResponse.json(leagueState(session), { headers: noStore });
    setSessionCookie(res, session, req);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
