import type { LeagueSnapshot } from "@/lib/domain/types";

export interface ProjectionHorizon {
  /** The scope of the projection; see docs/CALCULATION.md. */
  kind: "current-matchup-period" | "full-season";
  /** Prominent label, e.g. "NFL week 9 (current scoring period)". */
  label: string;
  matchupPeriodId: number | null;
  /** Scoring periods in which a lineup is set independently (NFL week / NBA day). */
  scoringPeriodIds: number[];
  /** Why this horizon, and what it is not. */
  note: string;
}

export interface PlayerHorizonProjection {
  /** Projected points per scoring period; null = projection missing (never treated as 0). */
  perPeriod: (number | null)[];
  /** Sum over the horizon, or null if any period is missing. */
  total: number | null;
  /** Human-readable basis, e.g. "ESPN weekly projection (league scoring)". */
  basis: string;
  missingReason: string | null;
  /** Scheduled pro games within the horizon, when the schedule is known. */
  gamesScheduled: number | null;
}

export type ProjectionSet =
  | {
      status: "available";
      horizon: ProjectionHorizon;
      source: string;
      /** When the projection inputs were fetched from the source. */
      fetchedAt: string;
      byPlayer: Record<string, PlayerHorizonProjection>;
      limitations: string[];
    }
  | { status: "unavailable"; reason: string; source: string; fetchedAt: string };

/**
 * Source of projections for a horizon. The snapshot-based implementation reads
 * projections that arrived with the league data; a separate data provider can
 * implement this interface without touching the calculation engine.
 */
export interface ProjectionProvider {
  readonly name: string;
  project(snapshot: LeagueSnapshot, playerIds: number[]): ProjectionSet;
}
