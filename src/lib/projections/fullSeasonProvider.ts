import type { LeagueSnapshot } from "@/lib/domain/types";
import { scoreSplit } from "./scoring";
import type { PlayerHorizonProjection, ProjectionProvider, ProjectionSet } from "./types";

/**
 * Scores each player's ESPN full-season projected stat line with the league's
 * chosen scoring rules. Used by user-built ("custom") leagues, where there is
 * no league calendar to define a weekly/daily window.
 */
export class FullSeasonProjectionProvider implements ProjectionProvider {
  readonly name = "full-season";

  project(snapshot: LeagueSnapshot, playerIds: number[]): ProjectionSet {
    const base = { source: `${snapshot.sourceLabel} full-season projections`, fetchedAt: snapshot.fetchedAt };
    const items = snapshot.settings.scoringItems;
    if (items.length === 0) {
      return { status: "unavailable", reason: "This league has no scoring rules, so projected points cannot be computed.", ...base };
    }
    const byPlayer: Record<string, PlayerHorizonProjection> = {};
    for (const id of playerIds) {
      const p = snapshot.players[String(id)];
      const scored = p ? scoreSplit(p.projections.season, "total", items, p.positionSlotId) : null;
      if (!p) {
        byPlayer[String(id)] = { perPeriod: [null], total: null, basis: "none", missingReason: "Player details were not found.", gamesScheduled: null };
      } else if (!scored) {
        byPlayer[String(id)] = { perPeriod: [null], total: null, basis: "none", missingReason: "ESPN did not return a full-season projection for this player.", gamesScheduled: null };
      } else {
        byPlayer[String(id)] = {
          perPeriod: [scored.points],
          total: scored.points,
          basis: "ESPN full-season projected stats, scored with this league's rules",
          missingReason: null,
          gamesScheduled: null,
        };
      }
    }
    return {
      status: "available",
      horizon: {
        kind: "full-season",
        label: "ESPN full-season projection",
        matchupPeriodId: null,
        scoringPeriodIds: [0],
        note:
          "Full-season projected totals from ESPN, scored with this league's rules, for a single best starting lineup. This is a season-long projected-points comparison, not a weekly matchup or a guarantee.",
      },
      byPlayer,
      limitations: [],
      ...base,
    };
  }
}
