import { round1 } from "@/lib/engine/trade";
import type { TradeAnalysis } from "@/lib/engine/types";
import { aiExplanationSchema, type AiExplanation } from "./schema";

export type ValidationOutcome =
  | { ok: true; explanation: AiExplanation }
  | { ok: false; reason: string };

/** Every percentage the AI is allowed to cite (absolute values, one decimal). */
export function allowedPercentages(analysis: TradeAnalysis): Set<string> {
  const out = new Set<string>();
  for (const t of analysis.teams) {
    if (t.percentChange !== null) out.add(Math.abs(round1(t.percentChange)).toFixed(1));
  }
  return out;
}

const PCT_RE = /(\d+(?:\.\d+)?)\s?(?:%|percent\b)/gi;

function allText(e: AiExplanation): string[] {
  return [
    e.summary,
    ...e.teams.flatMap((t) => [t.explanation, ...t.positionalImprovements, ...t.positionalWeaknesses, ...t.depthAndRosterImplications]),
    ...e.risks,
    ...e.assumptions,
    ...e.limitations,
  ];
}

/**
 * Parses raw model output and checks it against the deterministic results:
 * schema-valid, same verdict, both teams present, and every percentage it
 * mentions must be one of the calculated percentages (to one decimal).
 */
export function validateAiOutput(raw: string, analysis: TradeAnalysis): ValidationOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "AI response was not valid JSON." };
  }
  const parsed = aiExplanationSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "AI response did not match the required schema." };
  const e = parsed.data;
  if (e.verdict !== analysis.verdict) {
    return { ok: false, reason: "AI response contradicted the calculated verdict." };
  }
  const labels = new Set(e.teams.map((t) => t.team));
  if (!labels.has("Team A") || !labels.has("Team B")) {
    return { ok: false, reason: "AI response did not explain both teams." };
  }
  const allowed = allowedPercentages(analysis);
  for (const text of allText(e)) {
    for (const m of text.matchAll(PCT_RE)) {
      const value = Number(m[1]).toFixed(1);
      if (!allowed.has(value)) {
        return { ok: false, reason: `AI response cited a percentage (${m[0].trim()}) that does not match the calculation.` };
      }
    }
  }
  return { ok: true, explanation: e };
}
