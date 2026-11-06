import { NextResponse, type NextRequest } from "next/server";
import { playerSearchSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { getPlayerPool, searchPool } from "@/lib/espn/playerPool";
import { presetById } from "@/lib/league/presets";
import type { PlayerSearchResponse } from "@/lib/domain/apiTypes";
import { allowRate, errorResponse, noStore, requireSession } from "@/lib/server/http";

/** Search the live ESPN player pool, ranked by projected points under the league's scoring. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);
    if (session.mode !== "custom" || !session.customLeague) throw new AppError("CONFLICT", "Player search is only available in a custom league.");
    if (!allowRate(session, "search", 60, 60_000)) throw new AppError("RATE_LIMITED", "Too many searches. Try again in a moment.");
    const parsed = playerSearchSchema.safeParse({ q: req.nextUrl.searchParams.get("q") ?? "", limit: req.nextUrl.searchParams.get("limit") ?? undefined });
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid search.");

    const league = session.customLeague;
    const preset = presetById(league.presetId);
    if (!preset) throw new AppError("CONFIG", "The league's scoring preset is unavailable.");
    const pool = await getPlayerPool(league.sport, league.season);
    const taken = new Set(league.teams.flatMap((t) => t.playerIds));
    const players = searchPool(pool, parsed.data.q, preset.scoringItems, parsed.data.limit, taken);
    return NextResponse.json({ players } satisfies PlayerSearchResponse, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
