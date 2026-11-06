import type { ProjectionHorizon } from "@/lib/projections/types";

export type Verdict = "both_improve" | "one_improves" | "neither_improves" | "insufficient_data";

export const VERDICT_LABEL: Record<Verdict, string> = {
  both_improve: "Both teams improve",
  one_improves: "One team improves",
  neither_improves: "Neither team improves",
  insufficient_data: "Insufficient data",
};

export interface LineupSlotResult {
  slotName: string;
  playerId: number | null;
  points: number;
}

export interface PeriodLineup {
  scoringPeriodId: number;
  total: number;
  slots: LineupSlotResult[];
  unfilledSlots: string[];
}

export interface RosterEvaluation {
  /** Sum of optimal lineups over the horizon. */
  total: number;
  periods: PeriodLineup[];
  /** Roster players left out because their projection is missing. */
  excludedMissing: number[];
  /** Active roster (non-IR) used for this evaluation. */
  roster: number[];
}

export type TeamSide = "A" | "B";

export interface TeamTradeResult {
  side: TeamSide;
  teamId: number;
  teamName: string;
  sent: number[];
  received: number[];
  drops: number[];
  adds: number[];
  requiredDrops: number;
  openSpotsAfter: number;
  before: RosterEvaluation;
  after: RosterEvaluation;
  /** null when status is "insufficient". */
  pointsBefore: number | null;
  pointsAfter: number | null;
  pointDelta: number | null;
  /** null when the baseline is zero or data is insufficient. */
  percentChange: number | null;
  status: "ok" | "insufficient";
  insufficientReasons: string[];
  assumptions: string[];
  warnings: string[];
}

export interface AnalyzedPlayer {
  id: number;
  name: string;
  position: string;
  proTeam: string | null;
  injuryStatus: string | null;
  projectedTotal: number | null;
  perPeriod: (number | null)[];
  gamesScheduled: number | null;
  basis: string;
  missingReason: string | null;
}

export interface TradeAnalysis {
  computedAt: string;
  snapshotFetchedAt: string;
  sport: "football" | "basketball";
  horizon: ProjectionHorizon;
  projectionSource: string;
  projectionFetchedAt: string;
  teams: [TeamTradeResult, TeamTradeResult];
  verdict: Verdict;
  players: Record<string, AnalyzedPlayer>;
  assumptions: string[];
  limitations: string[];
}
