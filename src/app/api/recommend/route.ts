import { NextResponse, type NextRequest } from "next/server";
import { recommendRequestSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { recommendTrades } from "@/lib/engine/recommend";
import { projectionProviderFor } from "@/lib/projections/select";
import { allowRate, assertSameOrigin, errorResponse, noStore, readJson, requireSession } from "@/lib/server/http";

/** Suggests trades for the players a team offers, scored like trade analysis. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const session = await requireSession(req);
    if (!allowRate(session, "recommend", 20, 60_000)) {
      throw new AppError("RATE_LIMITED", "Too many trade searches in a short time. Wait a moment and try again.");
    }
    const parsed = recommendRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", parsed.error.issues[0].message);
    const snapshot = session.snapshot;
    if (!snapshot) throw new AppError("CONFLICT", "League data has not loaded yet.");
    if (!snapshot.format.supported) throw new AppError("UNSUPPORTED_FORMAT", snapshot.format.reasons.join(" "));

    const ids = snapshot.teams.flatMap((t) => t.roster.map((r) => r.playerId));
    const projections = projectionProviderFor(snapshot).project(snapshot, ids);
    if (projections.status === "unavailable") throw new AppError("UPSTREAM_MALFORMED", `Projections are unavailable: ${projections.reason}`);

    const result = recommendTrades(snapshot, projections, parsed.data);
    return NextResponse.json({ ...result, snapshotFetchedAt: snapshot.fetchedAt }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
