import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { explainAnalysis } from "@/lib/ai/explain";
import { openAiProviderFromEnv } from "@/lib/ai/openai";
import { tradeRequestSchema } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { analyzeTrade } from "@/lib/engine/trade";
import { projectionProviderFor } from "@/lib/projections/select";
import { allowRate, assertSameOrigin, errorResponse, noStore, readJson, requireSession } from "@/lib/server/http";

/**
 * AI explanation. The analysis is recomputed server-side from the session
 * snapshot, so the model only ever sees numbers the engine produced (never
 * client-supplied values).
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const session = await requireSession(req);
    const parsed = tradeRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid trade request.");
    if (!session.snapshot) throw new AppError("CONFLICT", "League data has not loaded yet.");
    const analysis = analyzeTrade(session.snapshot, parsed.data, projectionProviderFor(session.snapshot));

    const key = createHash("sha256")
      .update(JSON.stringify([session.snapshot.fetchedAt, parsed.data.teamA, parsed.data.teamB]))
      .digest("hex");
    const cached = session.explanations.get(key);
    if (cached) return NextResponse.json(cached, { headers: noStore });

    if (!allowRate(session, "explain", 10, 10 * 60_000)) {
      throw new AppError("RATE_LIMITED", "AI explanation limit reached. The calculated results are unaffected; try again in a few minutes.");
    }
    const result = await explainAnalysis(analysis, session.snapshot, () => openAiProviderFromEnv());
    if (result.source === "ai") session.explanations.set(key, result);
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
