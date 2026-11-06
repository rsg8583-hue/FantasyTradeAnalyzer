import { round1 } from "@/lib/engine/trade";
import type { RosterEvaluation, TeamTradeResult, TradeAnalysis } from "@/lib/engine/types";
import { VERDICT_LABEL } from "@/lib/engine/types";
import { formatPct } from "./input";
import type { AiExplanation } from "./schema";

function pointsBySlot(ev: RosterEvaluation): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of ev.periods) for (const s of p.slots) m.set(s.slotName, (m.get(s.slotName) ?? 0) + s.points);
  return m;
}

function slotChanges(t: TeamTradeResult) {
  const before = pointsBySlot(t.before);
  const after = pointsBySlot(t.after);
  const improvements: string[] = [];
  const weaknesses: string[] = [];
  for (const slot of new Set([...before.keys(), ...after.keys()])) {
    const d = round1((after.get(slot) ?? 0) - (before.get(slot) ?? 0));
    if (d > 0) improvements.push(`${slot}: +${d.toFixed(1)} projected points from starters in this slot.`);
    if (d < 0) weaknesses.push(`${slot}: ${d.toFixed(1)} projected points from starters in this slot.`);
  }
  return { improvements, weaknesses };
}

/** Plain, template-based explanation used when the AI is unavailable or rejected. */
export function deterministicExplanation(analysis: TradeAnalysis): AiExplanation {
  const name = (id: number) => analysis.players[String(id)]?.name ?? `Player ${id}`;
  const teams = analysis.teams.map((t) => {
    const { improvements, weaknesses } = slotChanges(t);
    const explanation =
      t.percentChange === null || t.pointsBefore === null || t.pointsAfter === null
        ? `Team ${t.side} (${t.teamName}): ${t.insufficientReasons.join(" ") || "Not enough data to estimate the change."}`
        : `Team ${t.side} (${t.teamName}) projects ${round1(t.pointsBefore).toFixed(1)} starting-lineup points before and ${round1(t.pointsAfter).toFixed(1)} after (${(t.pointDelta ?? 0) >= 0 ? "+" : "−"}${Math.abs(round1(t.pointDelta ?? 0)).toFixed(1)} points, ${formatPct(t.percentChange)}) for ${analysis.horizon.label}.`;
    const depth: string[] = [];
    depth.push(`Sends ${t.sent.length} and receives ${t.received.length} player(s).`);
    if (t.drops.length) depth.push(`Must drop: ${t.drops.map(name).join(", ")}.`);
    if (t.adds.length) depth.push(`Adds from free agency: ${t.adds.map(name).join(", ")}.`);
    if (t.openSpotsAfter > 0) depth.push(`${t.openSpotsAfter} open roster spot(s) after the trade.`);
    return {
      team: `Team ${t.side}` as "Team A" | "Team B",
      explanation,
      positionalImprovements: improvements,
      positionalWeaknesses: weaknesses,
      depthAndRosterImplications: depth,
    };
  });
  return {
    verdict: analysis.verdict,
    summary: `${VERDICT_LABEL[analysis.verdict]} on projected starting-lineup points for ${analysis.horizon.label}. This is a projection-based estimate, not a win probability or a fairness judgement.`,
    teams,
    risks: [
      "Projections can change with injuries, role changes and news that is not reflected in the data snapshot.",
    ],
    // The UI already lists the calculation's assumptions and limitations next to this explanation.
    assumptions: [],
    limitations: [],
  };
}
