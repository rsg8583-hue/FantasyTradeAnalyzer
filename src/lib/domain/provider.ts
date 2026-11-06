import type { LeagueSnapshot, Sport } from "./types";

export interface LeagueLocator {
  leagueId: string;
  sport: Sport;
  season: number;
}

/**
 * A source of league data. The ESPN adapter and the demo fixtures both
 * implement this so the rest of the app is independent of either.
 */
export interface LeagueProvider {
  readonly id: "espn" | "demo" | "custom";
  fetchSnapshot(locator: LeagueLocator): Promise<LeagueSnapshot>;
}
