import type { TradeRequest, TradeSideRequest } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import type { FantasyTeam, LeagueSnapshot } from "@/lib/domain/types";
import type { ProjectionProvider, ProjectionSet } from "@/lib/projections/types";
import { optimizeLineup } from "./lineup";
import type {
  AnalyzedPlayer,
  RosterEvaluation,
  TeamSide,
  TeamTradeResult,
  TradeAnalysis,
  Verdict,
} from "./types";

export interface TeamPlan {
  side: TeamSide;
  team: FantasyTeam;
  sent: number[];
  received: number[];
  drops: number[];
  adds: number[];
  beforeActive: number[];
  /** Active roster after the trade, drops and adds. */
  afterActive: number[];
  requiredDrops: number;
  openSpotsAfter: number;
  assumptions: string[];
  warnings: string[];
}

export interface TradePlanResult {
  errors: string[];
  /** True when errors stem from rosters having changed since the trade was built. */
  stale: boolean;
  plans: [TeamPlan, TeamPlan] | null;
}

const fmtList = (names: string[]) => names.join(", ");

export function irSlotIds(snapshot: LeagueSnapshot): Set<number> {
  return new Set(snapshot.settings.slots.filter((s) => s.kind === "ir").map((s) => s.slotId));
}

export interface RosterCounts {
  /** Current active (non-IR) roster. */
  beforeActive: number[];
  /** Active roster after the swap, before drops and adds. */
  postTrade: number[];
  /** Active limit, raised to the current size if the team is already over it. */
  effectiveLimit: number;
  requiredDrops: number;
}

/** Roster-limit math for one team; shared by validation and the trade builder UI. */
export function rosterCounts(snapshot: LeagueSnapshot, team: FantasyTeam, sent: number[], received: number[]): RosterCounts {
  const ir = irSlotIds(snapshot);
  const beforeActive = team.roster.filter((r) => r.lineupSlotId === null || !ir.has(r.lineupSlotId)).map((r) => r.playerId);
  const sentSet = new Set(sent);
  const postTrade = [...beforeActive.filter((id) => !sentSet.has(id)), ...received];
  // Do not demand drops for an overage that existed before the trade.
  const effectiveLimit = Math.max(snapshot.settings.activeRosterLimit, beforeActive.length);
  return { beforeActive, postTrade, effectiveLimit, requiredDrops: Math.max(0, postTrade.length - effectiveLimit) };
}

/**
 * Validates ownership, duplicates, empty trades and roster limits, and builds
 * the before/after active rosters for both teams.
 */
export function planTrade(snapshot: LeagueSnapshot, req: TradeRequest): TradePlanResult {
  const errors: string[] = [];
  let stale = false;
  const name = (id: number) => snapshot.players[String(id)]?.name ?? `Player ${id}`;
  const teamA = snapshot.teams.find((t) => t.id === req.teamA.teamId);
  const teamB = snapshot.teams.find((t) => t.id === req.teamB.teamId);
  if (!teamA || !teamB) return { errors: ["Select two teams from this league."], stale: false, plans: null };
  if (teamA.id === teamB.id) return { errors: ["Select two different teams."], stale: false, plans: null };

  if (req.teamA.sends.length === 0 && req.teamB.sends.length === 0) {
    return { errors: ["Add at least one player to the trade."], stale: false, plans: null };
  }

  // Duplicates anywhere in the request.
  const all = [
    ...req.teamA.sends, ...req.teamB.sends,
    ...req.teamA.drops, ...req.teamB.drops,
    ...req.teamA.adds, ...req.teamB.adds,
  ];
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const id of all) (seen.has(id) ? dupes : seen).add(id);
  if (dupes.size > 0) {
    errors.push(`Each player can appear only once in a trade: ${fmtList([...dupes].map(name))}.`);
  }

  // Ownership against the current snapshot.
  for (const [team, side] of [[teamA, req.teamA], [teamB, req.teamB]] as const) {
    const owned = new Set(team.roster.map((r) => r.playerId));
    const notOwned = side.sends.filter((id) => !owned.has(id));
    if (notOwned.length > 0) {
      stale ||= req.snapshotFetchedAt !== snapshot.fetchedAt;
      errors.push(`${team.name} no longer rosters: ${fmtList(notOwned.map(name))}.`);
    }
  }
  if (errors.length > 0) return { errors, stale, plans: null };

  const ir = irSlotIds(snapshot);
  const freeAgents = snapshot.freeAgents.status === "available" ? new Set(snapshot.freeAgents.value) : null;

  const build = (sideKey: TeamSide, team: FantasyTeam, own: TradeSideRequest, other: TradeSideRequest): TeamPlan => {
    const assumptions: string[] = [];
    const warnings: string[] = [];
    const { beforeActive, postTrade, effectiveLimit, requiredDrops } = rosterCounts(snapshot, team, own.sends, other.sends);
    const sentSet = new Set(own.sends);
    const sentFromIr = team.roster.filter((r) => sentSet.has(r.playerId) && r.lineupSlotId !== null && ir.has(r.lineupSlotId));
    if (sentFromIr.length > 0) {
      warnings.push(`${fmtList(sentFromIr.map((r) => name(r.playerId)))} currently occupies an IR slot on ${team.name}.`);
    }
    if (other.sends.length > 0) {
      assumptions.push(`Players received by ${team.name} are assumed to occupy active roster spots, not IR.`);
    }

    const postSet = new Set(postTrade);
    const badDrops = own.drops.filter((id) => !postSet.has(id));
    if (badDrops.length > 0) errors.push(`${team.name} can only drop players on its post-trade roster: ${fmtList(badDrops.map(name))}.`);
    if (own.drops.length !== requiredDrops) {
      errors.push(
        requiredDrops === 0
          ? `${team.name} has roster room and does not need to drop anyone.`
          : `${team.name} would have ${postTrade.length} active players (limit ${effectiveLimit}) and must drop exactly ${requiredDrops}.`,
      );
    }
    const afterDrops = postTrade.filter((id) => !own.drops.includes(id));
    const openBeforeAdds = Math.max(0, effectiveLimit - afterDrops.length);

    if (own.adds.length > 0) {
      if (!freeAgents) {
        errors.push("Replacement players cannot be added because free-agent data is unavailable.");
      } else {
        const notFree = own.adds.filter((id) => !freeAgents.has(id));
        if (notFree.length > 0) errors.push(`Not in the free-agent pool: ${fmtList(notFree.map(name))}.`);
      }
      if (own.adds.length > openBeforeAdds) {
        errors.push(`${team.name} has ${openBeforeAdds} open roster spot(s) but ${own.adds.length} replacement(s) were selected.`);
      }
    }
    const afterActive = [...afterDrops, ...own.adds];
    const openSpotsAfter = Math.max(0, effectiveLimit - afterActive.length);
    if (openSpotsAfter > 0) {
      assumptions.push(
        freeAgents
          ? `${team.name} is left with ${openSpotsAfter} open roster spot(s); no replacement was selected, so the spot is treated as empty.`
          : `${team.name} is left with ${openSpotsAfter} open roster spot(s). Free-agent data is unavailable, so the spot is treated as empty and any replacement value is not counted.`,
      );
    }
    if (own.drops.length > 0) {
      assumptions.push(`${team.name} drops ${fmtList(own.drops.map(name))} to stay within the roster limit.`);
    }
    if (own.adds.length > 0) {
      assumptions.push(`${team.name} adds ${fmtList(own.adds.map(name))} from free agency (assumes the claim succeeds).`);
    }
    return {
      side: sideKey, team, sent: own.sends, received: other.sends, drops: own.drops, adds: own.adds,
      beforeActive, afterActive, requiredDrops, openSpotsAfter, assumptions, warnings,
    };
  };

  const planA = build("A", teamA, req.teamA, req.teamB);
  const planB = build("B", teamB, req.teamB, req.teamA);
  if (req.teamA.sends.length === 0 || req.teamB.sends.length === 0) {
    const giver = req.teamA.sends.length === 0 ? teamB : teamA;
    planA.warnings.push(`This is a one-sided trade: only ${giver.name} sends players.`);
  }
  if (errors.length > 0) return { errors, stale, plans: null };
  return { errors: [], stale: false, plans: [planA, planB] };
}

/** Evaluates a roster over every scoring period of the horizon. */
export function evaluateRoster(
  roster: number[],
  snapshot: LeagueSnapshot,
  projections: Extract<ProjectionSet, { status: "available" }>,
): RosterEvaluation {
  const excluded = new Set<number>();
  const periods = projections.horizon.scoringPeriodIds.map((periodId, idx) => {
    const candidates = roster.flatMap((id) => {
      const proj = projections.byPlayer[String(id)];
      const value = proj?.perPeriod[idx];
      if (value === null || value === undefined) {
        excluded.add(id);
        return [];
      }
      return [{ playerId: id, eligibleSlotIds: snapshot.players[String(id)]?.eligibleSlotIds ?? [], points: value }];
    });
    const lineup = optimizeLineup(candidates, snapshot.settings.slots);
    return {
      scoringPeriodId: periodId,
      total: lineup.total,
      slots: lineup.assignments.map((a) => ({ slotName: a.slotName, playerId: a.playerId, points: a.points })),
      unfilledSlots: lineup.unfilledSlots,
    };
  });
  return {
    total: periods.reduce((s, p) => s + p.total, 0),
    periods,
    excludedMissing: [...excluded].sort((a, b) => a - b),
    roster,
  };
}

/** 100 × (after − before) ÷ before; null when the baseline is not positive. */
export function percentChange(before: number, after: number): number | null {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
  return (100 * (after - before)) / before;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** A team "improves" when its percentage, as displayed (one decimal), is above zero. */
export function improves(pct: number): boolean {
  return round1(pct) > 0;
}

export function deriveVerdict(teams: TeamTradeResult[]): Verdict {
  if (teams.some((t) => t.percentChange === null)) return "insufficient_data";
  const n = teams.filter((t) => improves(t.percentChange as number)).length;
  return n === teams.length ? "both_improve" : n === 0 ? "neither_improves" : "one_improves";
}

export function analyzeTrade(
  snapshot: LeagueSnapshot,
  req: TradeRequest,
  provider: ProjectionProvider,
  now: () => Date = () => new Date(),
): TradeAnalysis {
  if (!snapshot.format.supported) {
    throw new AppError("UNSUPPORTED_FORMAT", snapshot.format.reasons.join(" "));
  }
  const planned = planTrade(snapshot, req);
  if (!planned.plans) {
    throw new AppError(planned.stale ? "CONFLICT" : "BAD_REQUEST", planned.errors.join(" "), {
      details: { errors: planned.errors, stale: planned.stale },
    });
  }
  const plans = planned.plans;
  const involved = new Set<number>();
  for (const p of plans) for (const id of [...p.beforeActive, ...p.afterActive]) involved.add(id);
  const projections = provider.project(snapshot, [...involved]);
  if (projections.status === "unavailable") {
    throw new AppError("UPSTREAM_MALFORMED", `Projections are unavailable: ${projections.reason}`);
  }

  const name = (id: number) => snapshot.players[String(id)]?.name ?? `Player ${id}`;
  const teams = plans.map((plan): TeamTradeResult => {
    const before = evaluateRoster(plan.beforeActive, snapshot, projections);
    const after = evaluateRoster(plan.afterActive, snapshot, projections);
    const changed = new Set([...plan.sent, ...plan.received, ...plan.drops, ...plan.adds]);
    const missingChanged = [...changed].filter((id) => projections.byPlayer[String(id)]?.total === null);
    const insufficientReasons: string[] = [];
    if (missingChanged.length > 0) {
      insufficientReasons.push(
        `Missing projections for ${fmtList(missingChanged.map(name))}. Missing projections are never treated as zero, so this team's change cannot be estimated.`,
      );
    }
    const warnings = [...plan.warnings];
    const unchangedMissing = [...new Set([...before.excludedMissing, ...after.excludedMissing])].filter((id) => !changed.has(id));
    if (unchangedMissing.length > 0) {
      warnings.push(
        `No projection for ${fmtList(unchangedMissing.map(name))}; left out of both lineups. If they would start, both totals are understated.`,
      );
    }
    const beforeUnfilled = new Set(before.periods.flatMap((p) => p.unfilledSlots));
    const newlyUnfilled = [...new Set(after.periods.flatMap((p) => p.unfilledSlots))].filter((s) => !beforeUnfilled.has(s));
    if (newlyUnfilled.length > 0) {
      warnings.push(
        `After the trade, ${plan.team.name} cannot fill these starting slots with an eligible player in at least one period: ${fmtList(newlyUnfilled)}. Empty slots score 0.`,
      );
    }

    const ok = insufficientReasons.length === 0;
    let pct: number | null = null;
    if (ok) {
      pct = percentChange(before.total, after.total);
      if (pct === null) insufficientReasons.push("The projected baseline is zero, so a percentage change is not available.");
    }
    return {
      side: plan.side,
      teamId: plan.team.id,
      teamName: plan.team.name,
      sent: plan.sent,
      received: plan.received,
      drops: plan.drops,
      adds: plan.adds,
      requiredDrops: plan.requiredDrops,
      openSpotsAfter: plan.openSpotsAfter,
      before,
      after,
      pointsBefore: ok ? before.total : null,
      pointsAfter: ok ? after.total : null,
      pointDelta: ok ? after.total - before.total : null,
      percentChange: pct,
      status: ok && pct !== null ? "ok" : "insufficient",
      insufficientReasons,
      assumptions: plan.assumptions,
      warnings,
    };
  }) as [TeamTradeResult, TeamTradeResult];

  const players: Record<string, AnalyzedPlayer> = {};
  for (const id of involved) {
    const p = snapshot.players[String(id)];
    const proj = projections.byPlayer[String(id)];
    players[String(id)] = {
      id,
      name: p?.name ?? `Player ${id}`,
      position: p?.position ?? "?",
      proTeam: p?.proTeamAbbrev ?? null,
      injuryStatus: p?.injuryStatus ?? null,
      projectedTotal: proj?.total ?? null,
      perPeriod: proj?.perPeriod ?? [],
      gamesScheduled: proj?.gamesScheduled ?? null,
      basis: proj?.basis ?? "none",
      missingReason: proj?.missingReason ?? null,
    };
  }

  return {
    computedAt: now().toISOString(),
    snapshotFetchedAt: snapshot.fetchedAt,
    sport: snapshot.settings.sport,
    horizon: projections.horizon,
    projectionSource: projections.source,
    projectionFetchedAt: projections.fetchedAt,
    teams,
    verdict: deriveVerdict(teams),
    players,
    assumptions: [
      "Each team's lineup is re-optimized for the projection window both before and after the trade.",
      "Percentages compare projected starting-lineup points only; bench depth is not counted.",
      ...teams.flatMap((t) => t.assumptions),
    ],
    limitations: [projections.horizon.note, ...projections.limitations, ...snapshot.warnings],
  };
}
