import "server-only";
import type { LeagueLocator, LeagueProvider } from "@/lib/domain/provider";
import type { DataAvailability, LeagueSnapshot, ProSchedule } from "@/lib/domain/types";
import { isAppError } from "@/lib/domain/errors";
import { EspnClient, type EspnCredentials, type EspnRequestContext } from "./client";
import {
  detectFormat,
  normalizeFreeAgents,
  normalizeProSchedule,
  normalizeSettings,
  normalizeTeams,
  unavailable,
} from "./normalize";
import {
  rawLeagueSettingsResponseSchema,
  rawLeagueTeamsResponseSchema,
  rawPlayerPoolResponseSchema,
  rawProScheduleResponseSchema,
} from "./schemas";

export const FREE_AGENT_LIMIT = 50;

/** x-fantasy-filter for the free-agent pool (shape from espn-api free_agents). */
export function freeAgentFilter(limit = FREE_AGENT_LIMIT) {
  return {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      limit,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
}

export class EspnLeagueProvider implements LeagueProvider {
  readonly id = "espn" as const;

  constructor(
    private readonly credentials: EspnCredentials | null,
    private readonly client: EspnClient = new EspnClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchSnapshot(locator: LeagueLocator): Promise<LeagueSnapshot> {
    const ctx: EspnRequestContext = { ...locator, credentials: this.credentials };

    // 1. Settings + status (also tells us the current scoring period).
    const rawSettings = await this.client.get(ctx, { kind: "league", views: ["mSettings"] }, rawLeagueSettingsResponseSchema);
    const { settings, warnings } = normalizeSettings(rawSettings, locator.sport, locator.season, locator.leagueId);
    const scoringPeriodId = settings.currentScoringPeriod ?? undefined;

    // 2. Teams and rosters for the current scoring period (includes player
    //    stat splits, from which projections are read).
    const rawTeams = await this.client.get(
      ctx,
      { kind: "league", views: ["mTeam", "mRoster"], scoringPeriodId },
      rawLeagueTeamsResponseSchema,
    );
    const { teams, players, warnings: teamWarnings } = normalizeTeams(rawTeams, locator.sport, locator.season);
    warnings.push(...teamWarnings);

    // 3 & 4 are optional enrichments: failure makes them "unavailable", not empty.
    const [freeAgentsResult, scheduleResult] = await Promise.allSettled([
      this.client.get(
        ctx,
        { kind: "league", views: ["kona_player_info"], scoringPeriodId, filter: freeAgentFilter() },
        rawPlayerPoolResponseSchema,
      ),
      this.client.get(ctx, { kind: "proSchedule" }, rawProScheduleResponseSchema),
    ]);

    let freeAgents: DataAvailability<number[]>;
    if (freeAgentsResult.status === "fulfilled") {
      const fa = normalizeFreeAgents(freeAgentsResult.value, locator.sport, locator.season);
      Object.assign(players, fa.players);
      freeAgents = { status: "available", value: fa.ids };
    } else {
      rethrowIfAuth(freeAgentsResult.reason);
      freeAgents = unavailable(`Free-agent pool could not be loaded: ${messageOf(freeAgentsResult.reason)}`);
    }

    let proSchedule: DataAvailability<ProSchedule>;
    if (scheduleResult.status === "fulfilled") {
      proSchedule = { status: "available", value: normalizeProSchedule(scheduleResult.value) };
    } else {
      proSchedule = unavailable(`Pro team schedule could not be loaded: ${messageOf(scheduleResult.reason)}`);
    }

    return {
      source: "espn",
      sourceLabel: "ESPN Fantasy (unofficial API)",
      fetchedAt: this.now().toISOString(),
      rosterScoringPeriod: scoringPeriodId ?? null,
      settings,
      format: detectFormat(settings),
      teams,
      players,
      freeAgents,
      proSchedule,
      warnings,
    };
  }
}

function rethrowIfAuth(e: unknown) {
  if (isAppError(e) && (e.code === "AUTH_INVALID" || e.code === "AUTH_REQUIRED")) throw e;
}

function messageOf(e: unknown): string {
  return isAppError(e) ? e.message : "unknown error";
}
