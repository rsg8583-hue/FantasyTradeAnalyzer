import { NextResponse, type NextRequest } from "next/server";
import { createCustomRequestSchema, customActionSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { applyAction, newCustomLeague } from "@/lib/custom/mutate";
import { presetById } from "@/lib/league/presets";
import { getPlayerPool } from "@/lib/espn/playerPool";
import { buildCustomSnapshot } from "@/lib/custom/provider";
import { accountStore } from "@/lib/accounts/store";
import { currentUser, persistLeague } from "@/lib/server/accounts";
import { allowRate, assertSameOrigin, errorResponse, noStore, readJson, requireSession, setSessionCookie, startSession } from "@/lib/server/http";
import { leagueState } from "@/lib/server/state";

/** Create a new custom league (starts a session). Signed-in users get it saved to their account. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const parsed = createCustomRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", parsed.error.issues.map((i) => i.message).join(" "));
    const preset = presetById(parsed.data.presetId);
    if (!preset || preset.sport !== parsed.data.sport) throw new AppError("BAD_REQUEST", "Choose a scoring preset for the selected sport.");

    // Fail fast if ESPN's projection pool is unreachable, so we never show an empty league.
    await getPlayerPool(parsed.data.sport, parsed.data.season);

    const user = currentUser(req);
    const league = newCustomLeague(parsed.data);
    let savedLeagueId: number | null = null;
    if (user) {
      savedLeagueId = accountStore().createLeague(user.id, league);
      accountStore().setActiveLeague(user.id, savedLeagueId);
    }
    const session = startSession(req, {
      mode: "custom",
      locator: { leagueId: "custom", sport: parsed.data.sport, season: parsed.data.season },
      credentials: null,
      customLeague: league,
      userId: user?.id ?? null,
      savedLeagueId,
    });
    await rebuild(session);
    const res = NextResponse.json(leagueState(session), { headers: noStore });
    setSessionCookie(res, session, req);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

/** Apply one edit (add/remove team or player) and rebuild the snapshot. */
export async function PATCH(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const session = requireSession(req);
    if (session.mode !== "custom" || !session.customLeague) throw new AppError("CONFLICT", "This session is not a custom league.");
    if (!allowRate(session, "customEdit", 120, 60_000)) throw new AppError("RATE_LIMITED", "Too many edits at once. Slow down a moment.");
    const parsed = customActionSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid edit.");

    const pool = await getPlayerPool(session.customLeague.sport, session.customLeague.season);
    applyAction(session.customLeague, parsed.data, (id) => pool.byId.has(id));
    persistLeague(session);
    await rebuild(session);
    return NextResponse.json(leagueState(session), { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}

async function rebuild(session: ReturnType<typeof requireSession>) {
  if (!session.customLeague) return;
  const pool = await getPlayerPool(session.customLeague.sport, session.customLeague.season);
  session.snapshot = buildCustomSnapshot(session.customLeague, pool, new Date());
  session.sync.lastSuccessAt = session.snapshot.fetchedAt;
  session.sync.lastAttemptAt = session.snapshot.fetchedAt;
  session.sync.lastError = null;
  session.explanations.clear();
}
