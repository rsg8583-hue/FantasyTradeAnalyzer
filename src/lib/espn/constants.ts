import type { SlotKind, Sport } from "@/lib/domain/types";

// Verified against cwendt94/espn-api (espn_api/requests/constant.py and the
// football/basketball constant modules). ESPN's fantasy API is unofficial and
// undocumented; keep every ESPN-specific constant in this file so that an
// endpoint change is a one-place fix.

export const ESPN_READ_HOST = "lm-api-reads.fantasy.espn.com";
export const ESPN_ALLOWED_HOSTS: ReadonlySet<string> = new Set([ESPN_READ_HOST]);

export const ESPN_GAME_CODES: Record<Sport, string> = {
  football: "ffl",
  basketball: "fba",
};

/** Views this app is allowed to request. Anything else is rejected. */
export const ESPN_ALLOWED_VIEWS = new Set([
  "mSettings",
  "mTeam",
  "mRoster",
  "kona_player_info",
  "proTeamSchedules_wl",
]);

/** The only scoring type verified as a head-to-head points league. */
export const SUPPORTED_SCORING_TYPES = new Set(["H2H_POINTS"]);

export const CATEGORY_SCORING_TYPES = new Set([
  "H2H_CATEGORY",
  "H2H_MOST_CATEGORIES",
  "ROTO",
]);

interface SlotInfo {
  name: string;
  kind: SlotKind | "ignore";
}

export const FOOTBALL_SLOTS: Record<number, SlotInfo> = {
  0: { name: "QB", kind: "starter" },
  1: { name: "TQB", kind: "starter" },
  2: { name: "RB", kind: "starter" },
  3: { name: "RB/WR", kind: "starter" },
  4: { name: "WR", kind: "starter" },
  5: { name: "WR/TE", kind: "starter" },
  6: { name: "TE", kind: "starter" },
  7: { name: "OP", kind: "starter" },
  8: { name: "DT", kind: "starter" },
  9: { name: "DE", kind: "starter" },
  10: { name: "LB", kind: "starter" },
  11: { name: "DL", kind: "starter" },
  12: { name: "CB", kind: "starter" },
  13: { name: "S", kind: "starter" },
  14: { name: "DB", kind: "starter" },
  15: { name: "DP", kind: "starter" },
  16: { name: "D/ST", kind: "starter" },
  17: { name: "K", kind: "starter" },
  18: { name: "P", kind: "starter" },
  19: { name: "HC", kind: "starter" },
  20: { name: "BE", kind: "bench" },
  21: { name: "IR", kind: "ir" },
  22: { name: "", kind: "ignore" },
  23: { name: "FLEX", kind: "starter" },
  24: { name: "ER", kind: "ignore" },
  25: { name: "Rookie", kind: "ignore" },
};

export const BASKETBALL_SLOTS: Record<number, SlotInfo> = {
  0: { name: "PG", kind: "starter" },
  1: { name: "SG", kind: "starter" },
  2: { name: "SF", kind: "starter" },
  3: { name: "PF", kind: "starter" },
  4: { name: "C", kind: "starter" },
  5: { name: "G", kind: "starter" },
  6: { name: "F", kind: "starter" },
  7: { name: "SG/SF", kind: "starter" },
  8: { name: "G/F", kind: "starter" },
  9: { name: "PF/C", kind: "starter" },
  10: { name: "F/C", kind: "starter" },
  11: { name: "UT", kind: "starter" },
  12: { name: "BE", kind: "bench" },
  13: { name: "IR", kind: "ir" },
  14: { name: "", kind: "ignore" },
  15: { name: "Rookie", kind: "ignore" },
};

export function slotTable(sport: Sport): Record<number, SlotInfo> {
  return sport === "football" ? FOOTBALL_SLOTS : BASKETBALL_SLOTS;
}

/**
 * Football primary position is derived from eligible slots (the espn-api
 * approach), in this priority order.
 */
export const FOOTBALL_POSITION_PRIORITY = [0, 2, 4, 6, 16, 17, 18, 8, 9, 10, 12, 13, 19];

/** Basketball: POSITION_MAP[defaultPositionId - 1] per espn-api. */
export const BASKETBALL_POSITION_SLOTS = [0, 1, 2, 3, 4];

export const NFL_TEAMS: Record<number, string> = {
  0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA",
  16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
  24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL",
  34: "HOU",
};

export const NBA_TEAMS: Record<number, string> = {
  0: "FA", 1: "ATL", 2: "BOS", 3: "NOP", 4: "CHI", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GSW", 10: "HOU", 11: "IND", 12: "LAC", 13: "LAL", 14: "MIA", 15: "MIL",
  16: "MIN", 17: "BKN", 18: "NYK", 19: "ORL", 20: "PHL", 21: "PHO", 22: "POR", 23: "SAC",
  24: "SAS", 25: "OKC", 26: "UTA", 27: "WAS", 28: "TOR", 29: "MEM", 30: "CHA",
};

/** ESPN stat-split encodings. statSourceId 1 = projected; statSplitTypeId 1 = single scoring period, 0 = season. */
export const STAT_SOURCE_PROJECTED = 1;
export const STAT_SPLIT_SEASON = 0;
export const STAT_SPLIT_SCORING_PERIOD = 1;
