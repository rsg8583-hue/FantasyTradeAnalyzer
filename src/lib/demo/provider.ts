import type { LeagueLocator, LeagueProvider } from "@/lib/domain/provider";
import type { LeagueSnapshot } from "@/lib/domain/types";
import { demoSnapshot } from "./fixtures";

/** Serves fictional fixture data. Only used when the user explicitly picks demo mode. */
export class DemoLeagueProvider implements LeagueProvider {
  readonly id = "demo" as const;

  async fetchSnapshot(locator: LeagueLocator): Promise<LeagueSnapshot> {
    return demoSnapshot(locator.sport);
  }
}
