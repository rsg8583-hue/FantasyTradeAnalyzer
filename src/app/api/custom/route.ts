import { NextResponse, type NextRequest } from "next/server";
import { createCustomRequestSchema, customActionSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { applyAction, newCustomLeague } from "@/lib/custom/mutate";
import { planTrade } from "@/lib/engine/trade";
import { presetById } from "@/lib/league/presets";
import { getPlayerPool } from "@/lib/espn/playerPool";
import { buildCustomSnapshot } from "@/lib/custom/provider";
import { accountStore } from "@/lib/accounts/store";
import { AUTH_COOKIE, currentUser, persistLeague, savedSessionInit } from "@/lib/server/accounts";
import type { SessionData, SessionInit } from "@/lib/session/store";
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

    const league = newCustomLeague(parsed.data);
    const accounts = req.cookies.has(AUTH_COOKIE) ? await accountStore() : null;
    const user = accounts ? await currentUser(req, accounts) : null;
    let init: SessionInit = {
      mode: "custom",
      locator: { leagueId: "custom", sport: parsed.data.sport, season: parsed.data.season },
      credentials: null,
      customLeague: league,
    };
    if (accounts && user) {
      const saved = await accounts.createLeague(user.id, league);
      await accounts.setActiveLeague(user.id, saved.id);
      init = savedSessionInit(user, saved);
    }
    const session = startSession(req, init);
    await rebuild(session);
    const res = NextResponse.json(leagueState(session), { headers: noStore });
    setSessionCookie(res, session, req);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

/** Apply one edit (add/remove team or player, or make a trade) and rebuild the snapshot. */
export async function PATCH(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const session = await requireSession(req);
    if (session.mode !== "custom" || !session.customLeague) throw new AppError("CONFLICT", "This session is not a custom league.");
    if (!allowRate(session, "customEdit", 120, 60_000)) throw new AppError("RATE_LIMITED", "Too many edits at once. Slow down a moment.");
    const parsed = customActionSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid edit.");

    if (parsed.data.action === "trade") {
      // Only a trade analyzed against the current rosters can be made, and it must pass the same checks.
      const trade = parsed.data.trade;
      if (!session.snapshot || session.snapshot.fetchedAt !== trade.snapshotFetchedAt) {
        throw new AppError("CONFLICT", "The league changed since this trade was analyzed. Re-analyze it, then make the trade.");
      }
      const plan = planTrade(session.snapshot, trade);
      if (plan.errors.length > 0) throw new AppError("BAD_REQUEST", plan.errors.join(" "));
    }

    const pool = await getPlayerPool(session.customLeague.sport, session.customLeague.season);
    applyAction(session.customLeague, parsed.data, (id) => pool.byId.has(id));
    await persistLeague(session);
    await rebuild(session);
    return NextResponse.json(leagueState(session), { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}

async function rebuild(session: SessionData) {
  if (!session.customLeague) return;
  const pool = await getPlayerPool(session.customLeague.sport, session.customLeague.season);
  session.snapshot = buildCustomSnapshot(session.customLeague, pool, new Date());
  session.sync.lastSuccessAt = session.snapshot.fetchedAt;
  session.sync.lastAttemptAt = session.snapshot.fetchedAt;
  session.sync.lastError = null;
  session.explanations.clear();
}
