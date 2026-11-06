import type { TradeRequest } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import type { FantasyTeam, LeagueSnapshot } from "@/lib/domain/types";
import type { ProjectionSet } from "@/lib/projections/types";
import { evaluateRoster, improves, percentChange, planTrade, rosterCounts } from "./trade";

export interface RecommendOptions {
  /** The team offering players. */
  teamId: number;
  offer: number[];
  /** Restrict to one trade partner; null searches every other team. */
  partnerTeamId: number | null;
  /** Largest package to ask for in return (1–3 players). */
  maxReceive: number;
  /** Suggestions returned per list. */
  limit?: number;
}

export interface TradeSuggestion {
  partnerTeamId: number;
  partnerTeamName: string;
  receive: number[];
  /** Drops picked automatically (lowest projected) to stay within the roster limit. */
  myDrops: number[];
  partnerDrops: number[];
  myDelta: number;
  myPct: number | null;
  partnerDelta: number;
  partnerPct: number | null;
  bothImprove: boolean;
}

export interface RecommendResult {
  /**
   * Trades that help the offering team, ranked so the team that gains less
   * (or loses more) comes out as well as possible. Win-win trades come first
   * when there are any; otherwise the ones that cost the partner least.
   */
  fair: TradeSuggestion[];
  /** Trades that raise the offering team's projection the most, whatever they do to the partner. */
  bestForMe: TradeSuggestion[];
  evaluated: number;
}

type Available = Extract<ProjectionSet, { status: "available" }>;

/** Every k-player combination of `items`, for k = 1..max. */
function packages(items: number[], max: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length > 0) out.push(acc);
    if (acc.length === max) return;
    for (let i = start; i < items.length; i++) pick(i + 1, [...acc, items[i]]);
  };
  pick(0, []);
  return out;
}

/**
 * Searches the partner teams' rosters for packages to receive for `offer`, and
 * scores each with the same optimal-lineup model as trade analysis. When a
 * team ends up over its roster limit, its lowest-projected players (other
 * than those it just received, where possible) are dropped.
 */
export function recommendTrades(snapshot: LeagueSnapshot, projections: Available, opts: RecommendOptions): RecommendResult {
  const limit = opts.limit ?? 10;
  const me = snapshot.teams.find((t) => t.id === opts.teamId);
  if (!me) throw new AppError("BAD_REQUEST", "Choose your team.");
  if (opts.offer.length === 0) throw new AppError("BAD_REQUEST", "Select at least one player to offer.");
  const mine = new Set(me.roster.map((r) => r.playerId));
  if (opts.offer.some((id) => !mine.has(id))) throw new AppError("CONFLICT", `${me.name}'s roster changed. Refresh and pick players again.`);

  const total = (id: number) => projections.byPlayer[String(id)]?.total ?? null;
  const name = (id: number) => snapshot.players[String(id)]?.name ?? `Player ${id}`;
  const noProjection = opts.offer.filter((id) => total(id) === null);
  if (noProjection.length > 0) {
    throw new AppError("BAD_REQUEST", `No projection for ${noProjection.map(name).join(", ")}, so trades for them can't be scored.`);
  }

  const partners = snapshot.teams.filter((t) => t.id !== me.id && (opts.partnerTeamId === null || t.id === opts.partnerTeamId));
  if (partners.length === 0) throw new AppError("BAD_REQUEST", "Choose a different team to trade with.");

  const baseline = new Map<number, number>();
  const base = (team: FantasyTeam) => {
    if (!baseline.has(team.id)) baseline.set(team.id, evaluateRoster(rosterCounts(snapshot, team, [], []).beforeActive, snapshot, projections).total);
    return baseline.get(team.id)!;
  };

  /** The `count` lowest-projected players of the post-trade roster, preferring ones the team didn't just receive. */
  const autoDrops = (team: FantasyTeam, sent: number[], received: number[], count: number): number[] => {
    if (count === 0) return [];
    const post = rosterCounts(snapshot, team, sent, received).postTrade;
    const incoming = new Set(received);
    // Players without a projection go first; they can't add to a lineup. (Finite, so subtraction never gives NaN.)
    const value = (id: number) => total(id) ?? -1e12;
    const rank = (id: number) => (incoming.has(id) ? 1 : 0);
    return [...post].sort((x, y) => rank(x) - rank(y) || value(x) - value(y) || x - y).slice(0, count);
  };

  const maxReceive = Math.min(3, Math.max(1, Math.floor(opts.maxReceive)));
  const suggestions: TradeSuggestion[] = [];
  let evaluated = 0;
  const myBefore = base(me);

  for (const partner of partners) {
    const partnerBefore = base(partner);
    // Only players with a projection can be scored; receiving one without would hide its value.
    const pool = partner.roster.map((r) => r.playerId).filter((id) => total(id) !== null);
    for (const receive of packages(pool, maxReceive)) {
      const myDrops = autoDrops(me, opts.offer, receive, rosterCounts(snapshot, me, opts.offer, receive).requiredDrops);
      const partnerDrops = autoDrops(partner, receive, opts.offer, rosterCounts(snapshot, partner, receive, opts.offer).requiredDrops);
      const req: TradeRequest = {
        snapshotFetchedAt: snapshot.fetchedAt,
        teamA: { teamId: me.id, sends: opts.offer, drops: myDrops, adds: [] },
        teamB: { teamId: partner.id, sends: receive, drops: partnerDrops, adds: [] },
      };
      const plan = planTrade(snapshot, req).plans;
      if (!plan) continue;
      evaluated++;
      const myAfter = evaluateRoster(plan[0].afterActive, snapshot, projections).total;
      const partnerAfter = evaluateRoster(plan[1].afterActive, snapshot, projections).total;
      const myPct = percentChange(myBefore, myAfter);
      const partnerPct = percentChange(partnerBefore, partnerAfter);
      if (myAfter - myBefore <= 0) continue;
      suggestions.push({
        partnerTeamId: partner.id,
        partnerTeamName: partner.name,
        receive,
        myDrops,
        partnerDrops,
        myDelta: myAfter - myBefore,
        myPct,
        partnerDelta: partnerAfter - partnerBefore,
        partnerPct,
        bothImprove: myPct !== null && partnerPct !== null && improves(myPct) && improves(partnerPct),
      });
    }
  }

  // A package that does no better for either team than part of itself (e.g. a backup who'd never start
  // tacked on) adds nothing, so leave it out.
  const key = (partnerId: number, ids: number[]) => `${partnerId}:${[...ids].sort((x, y) => x - y).join(",")}`;
  const found = new Map(suggestions.map((s) => [key(s.partnerTeamId, s.receive), s]));
  const EPS = 1e-6;
  const useful = suggestions.filter((s) =>
    !packages(s.receive, s.receive.length - 1).some((sub) => {
      const smaller = found.get(key(s.partnerTeamId, sub));
      return smaller !== undefined && smaller.myDelta >= s.myDelta - EPS && smaller.partnerDelta >= s.partnerDelta - EPS;
    }),
  );

  const tieBreak = (x: TradeSuggestion, y: TradeSuggestion) => x.receive.length - y.receive.length || x.partnerTeamId - y.partnerTeamId;
  const byMyGain = (x: TradeSuggestion, y: TradeSuggestion) => y.myDelta - x.myDelta || y.partnerDelta - x.partnerDelta || tieBreak(x, y);
  const worseSide = (s: TradeSuggestion) => Math.min(s.myDelta, s.partnerDelta);
  const byFairness = (x: TradeSuggestion, y: TradeSuggestion) => worseSide(y) - worseSide(x) || byMyGain(x, y);
  return {
    fair: [...useful].sort(byFairness).slice(0, limit),
    bestForMe: [...useful].sort(byMyGain).slice(0, limit),
    evaluated,
  };
}
