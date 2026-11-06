import type { RosterSlot, ScoringItem, Sport } from "@/lib/domain/types";

// Scoring + roster presets for user-built ("custom") leagues. ESPN supplies
// each player's projected stat line; the chosen preset's scoring rules turn
// that into projected points. Football stat ids follow ESPN's PLAYER_STATS_MAP.

export interface LeaguePreset {
  id: string;
  sport: Sport;
  label: string;
  description: string;
  slots: RosterSlot[];
  scoringItems: ScoringItem[];
}

const noOverrides = (statId: number, points: number): ScoringItem => ({ statId, points, pointsOverrides: {} });

// ESPN football stat ids used for scoring.
const PASS_YDS = 3, PASS_TD = 4, PASS_INT = 20, PASS_2PT = 19;
const RUSH_YDS = 24, RUSH_TD = 25, RUSH_2PT = 26;
const REC = 53, REC_YDS = 42, REC_TD = 43, REC_2PT = 44;
const FUM_LOST = 72, FUM_TD = 74;
// Kicking / defense (team D/ST) approximations.
const FG_MADE = 83, XP_MADE = 86, DEF_INT = 95, DEF_FUM = 96, DEF_SACK = 99, DEF_TD = 101, DEF_SAFETY = 98;

function footballScoring(ppr: number): ScoringItem[] {
  return [
    noOverrides(PASS_YDS, 0.04),
    noOverrides(PASS_TD, 4),
    noOverrides(PASS_INT, -2),
    noOverrides(PASS_2PT, 2),
    noOverrides(RUSH_YDS, 0.1),
    noOverrides(RUSH_TD, 6),
    noOverrides(RUSH_2PT, 2),
    noOverrides(REC, ppr),
    noOverrides(REC_YDS, 0.1),
    noOverrides(REC_TD, 6),
    noOverrides(REC_2PT, 2),
    noOverrides(FUM_LOST, -2),
    noOverrides(FUM_TD, 6),
    noOverrides(FG_MADE, 3),
    noOverrides(XP_MADE, 1),
    noOverrides(DEF_SACK, 1),
    noOverrides(DEF_INT, 2),
    noOverrides(DEF_FUM, 2),
    noOverrides(DEF_TD, 6),
    noOverrides(DEF_SAFETY, 2),
  ];
}

const FOOTBALL_SLOTS: RosterSlot[] = [
  { slotId: 0, name: "QB", count: 1, kind: "starter" },
  { slotId: 2, name: "RB", count: 2, kind: "starter" },
  { slotId: 4, name: "WR", count: 2, kind: "starter" },
  { slotId: 6, name: "TE", count: 1, kind: "starter" },
  { slotId: 23, name: "FLEX", count: 1, kind: "starter" },
  { slotId: 16, name: "D/ST", count: 1, kind: "starter" },
  { slotId: 17, name: "K", count: 1, kind: "starter" },
  { slotId: 20, name: "BE", count: 6, kind: "bench" },
  { slotId: 21, name: "IR", count: 1, kind: "ir" },
];

// ESPN basketball stat ids (points-league scoring).
const PTS = 0, BLK = 1, STL = 2, AST = 3, REB = 6, TO = 11, FGM = 13, FGA = 14, FTM = 15, FTA = 16, TPM = 17;

const BASKETBALL_SCORING: ScoringItem[] = [
  noOverrides(PTS, 1),
  noOverrides(REB, 1),
  noOverrides(AST, 2),
  noOverrides(STL, 4),
  noOverrides(BLK, 4),
  noOverrides(TO, -2),
  noOverrides(FGM, 2),
  noOverrides(FGA, -1),
  noOverrides(FTM, 1),
  noOverrides(FTA, -1),
  noOverrides(TPM, 1),
];

const BASKETBALL_SLOTS: RosterSlot[] = [
  { slotId: 0, name: "PG", count: 1, kind: "starter" },
  { slotId: 1, name: "SG", count: 1, kind: "starter" },
  { slotId: 2, name: "SF", count: 1, kind: "starter" },
  { slotId: 3, name: "PF", count: 1, kind: "starter" },
  { slotId: 4, name: "C", count: 1, kind: "starter" },
  { slotId: 5, name: "G", count: 1, kind: "starter" },
  { slotId: 6, name: "F", count: 1, kind: "starter" },
  { slotId: 11, name: "UT", count: 3, kind: "starter" },
  { slotId: 12, name: "BE", count: 3, kind: "bench" },
  { slotId: 13, name: "IR", count: 1, kind: "ir" },
];

export const PRESETS: LeaguePreset[] = [
  { id: "ffl-ppr", sport: "football", label: "PPR (1.0 per reception)", description: "Standard ESPN PPR scoring, 1 point per reception.", slots: FOOTBALL_SLOTS, scoringItems: footballScoring(1) },
  { id: "ffl-half", sport: "football", label: "Half-PPR (0.5 per reception)", description: "0.5 points per reception.", slots: FOOTBALL_SLOTS, scoringItems: footballScoring(0.5) },
  { id: "ffl-standard", sport: "football", label: "Standard (no PPR)", description: "No points for receptions.", slots: FOOTBALL_SLOTS, scoringItems: footballScoring(0) },
  { id: "fba-points", sport: "basketball", label: "Points league", description: "Common ESPN points scoring (PTS 1, REB 1, AST 2, STL/BLK 4, TO −2, plus shooting).", slots: BASKETBALL_SLOTS, scoringItems: BASKETBALL_SCORING },
];

export function presetById(id: string): LeaguePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function presetsForSport(sport: Sport): LeaguePreset[] {
  return PRESETS.filter((p) => p.sport === sport);
}

export function defaultPresetId(sport: Sport): string {
  return presetsForSport(sport)[0].id;
}
