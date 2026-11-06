import type { Sport } from "@/lib/domain/types";

export interface CustomTeam {
  id: number;
  name: string;
  /** Player ids referencing the ESPN player pool. */
  playerIds: number[];
}

/** A user-built league. Players carry live ESPN projections; no ESPN league is linked. */
export interface CustomLeague {
  name: string;
  sport: Sport;
  season: number;
  presetId: string;
  nextTeamId: number;
  teams: CustomTeam[];
}
