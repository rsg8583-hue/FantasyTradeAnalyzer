import { NextResponse, type NextRequest } from "next/server";
import { tradeRequestSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { analyzeTrade } from "@/lib/engine/trade";
import { projectionProviderFor } from "@/lib/projections/select";
import { allowRate, assertSameOrigin, errorResponse, noStore, readJson, requireSession } from "@/lib/server/http";

/** Deterministic trade calculation against the session's current snapshot. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const session = await requireSession(req);
    if (!allowRate(session, "analyze", 30, 60_000)) {
      throw new AppError("RATE_LIMITED", "Too many analyses in a short time. Wait a moment and try again.");
    }
    const parsed = tradeRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid trade request.");
    if (!session.snapshot) throw new AppError("CONFLICT", "League data has not loaded yet.");
    const analysis = analyzeTrade(session.snapshot, parsed.data, projectionProviderFor(session.snapshot));
    return NextResponse.json(analysis, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
