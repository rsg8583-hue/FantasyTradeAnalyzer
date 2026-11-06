import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, noStore, requireSession } from "@/lib/server/http";
import { syncLeague } from "@/lib/server/leagueService";
import { leagueState } from "@/lib/server/state";

/** Polling endpoint: syncs only if the cached snapshot is older than a minute. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);
    await syncLeague(session, { force: false });
    return NextResponse.json(leagueState(session), { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Manual "Refresh League". Failures keep the last good snapshot (marked stale). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const session = await requireSession(req);
    await syncLeague(session, { force: true });
    return NextResponse.json(leagueState(session), { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
