// Normalized, provider-independent league model. Everything the UI, the
// calculation engine and the AI layer consume is expressed in these types;
// nothing here may contain credentials.

export type Sport = "football" | "basketball";

export const SPORTS: readonly Sport[] = ["football", "basketball"] as const;

export type SlotKind = "starter" | "bench" | "ir";

export interface RosterSlot {
  slotId: number;
  name: string;
  count: number;
  kind: SlotKind;
}

export interface ScoringItem {
  statId: number;
  points: number;
  /** Per-position overrides keyed by lineup slot id (as ESPN encodes them). */
  pointsOverrides: Record<string, number>;
}

/** Raw stat line as returned by the data source (stat id -> value). */
export type StatLine = Record<string, number>;

export interface StatSplit {
  /** League-scored total for the split, when the provider supplies one. */
  appliedTotal: number | null;
  /** League-scored per-game average, when the provider supplies one. */
  appliedAverage: number | null;
  /** Raw stat totals for the split, when supplied. */
  stats: StatLine | null;
  /** Raw per-game stat averages for the split, when supplied. */
  averageStats: StatLine | null;
}

export interface PlayerProjectionData {
  /** Projected stats keyed by scoring period id (e.g. NFL week). */
  byScoringPeriod: Record<string, StatSplit>;
  /** Projected full-season split (basketball per-game averages live here). */
  season: StatSplit | null;
}

export interface Player {
  id: number;
  name: string;
  /** Primary position label, e.g. "RB" or "PG". */
  position: string;
  /** Slot id that represents the primary position (used for scoring overrides). */
  positionSlotId: number | null;
  eligibleSlotIds: number[];
  proTeamId: number | null;
  proTeamAbbrev: string | null;
  /** Injury status exactly as reported by the provider, or null if not reported. */
  injuryStatus: string | null;
  projections: PlayerProjectionData;
}

export interface RosterEntry {
  playerId: number;
  /** Current lineup slot on the fantasy team. */
  lineupSlotId: number | null;
}

export interface FantasyTeam {
  id: number;
  name: string;
  abbrev: string | null;
  roster: RosterEntry[];
}

export type FormatSupport =
  | { supported: true }
  | { supported: false; reasons: string[] };

export interface ProSchedule {
  /** proTeamId -> scoring period ids in which that team has at least one game. */
  gamesByTeam: Record<string, Record<string, number>>;
}

export type DataAvailability<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: string };

export interface LeagueSettings {
  leagueId: string;
  name: string;
  sport: Sport;
  season: number;
  /** Raw scoring type string as reported by the provider, e.g. "H2H_POINTS". */
  scoringType: string | null;
  scoringLabel: string;
  teamCount: number;
  keeperCount: number | null;
  slots: RosterSlot[];
  scoringItems: ScoringItem[];
  /** Maximum players outside IR slots (starters + bench). */
  activeRosterLimit: number;
  irSlotCount: number;
  currentMatchupPeriod: number | null;
  currentScoringPeriod: number | null;
  finalScoringPeriod: number | null;
  /** Matchup period id -> scoring period ids. */
  matchupPeriods: Record<string, number[]> | null;
}

export interface LeagueSnapshot {
  source: "espn" | "demo" | "custom";
  /** Human-readable source description shown in the UI and methodology. */
  sourceLabel: string;
  fetchedAt: string;
  /** Scoring period whose rosters/projections were requested. */
  rosterScoringPeriod: number | null;
  settings: LeagueSettings;
  format: FormatSupport;
  teams: FantasyTeam[];
  /** All players referenced by rosters or the free-agent pool, keyed by id. */
  players: Record<string, Player>;
  freeAgents: DataAvailability<number[]>;
  proSchedule: DataAvailability<ProSchedule>;
  /** Non-fatal problems found while importing (shown to the user). */
  warnings: string[];
}
