import "server-only";
import type { LeagueProvider } from "@/lib/domain/provider";
import type { FantasyTeam, LeagueSnapshot, Player } from "@/lib/domain/types";
import { AppError } from "@/lib/domain/errors";
import { EspnClient } from "@/lib/espn/client";
import { getPlayerPool, type PlayerPool } from "@/lib/espn/playerPool";
import { presetById } from "@/lib/league/presets";
import { unavailable } from "@/lib/espn/normalize";
import type { CustomLeague } from "./types";

/** Builds a league snapshot from a user-built league and the live ESPN player pool. */
export class CustomLeagueProvider implements LeagueProvider {
  readonly id = "custom" as const;

  constructor(
    private readonly league: CustomLeague,
    private readonly opts: { force?: boolean; client?: EspnClient; now?: () => Date } = {},
  ) {}

  async fetchSnapshot(): Promise<LeagueSnapshot> {
    const pool = await getPlayerPool(this.league.sport, this.league.season, {
      force: this.opts.force,
      client: this.opts.client,
    });
    return buildCustomSnapshot(this.league, pool, this.opts.now?.() ?? new Date());
  }
}

export function buildCustomSnapshot(league: CustomLeague, pool: PlayerPool, now: Date): LeagueSnapshot {
  const preset = presetById(league.presetId);
  if (!preset || preset.sport !== league.sport) {
    throw new AppError("CONFIG", "The league's scoring preset is no longer available.");
  }
  const players: Record<string, Player> = {};
  const warnings: string[] = [];
  const activeRosterLimit = preset.slots.filter((s) => s.kind !== "ir").reduce((a, s) => a + s.count, 0);

  const teams: FantasyTeam[] = league.teams.map((t) => {
    const roster = t.playerIds.flatMap((id) => {
      const p = pool.byId.get(id);
      if (!p) {
        warnings.push(`A player on ${t.name} is no longer in ESPN's projection pool and was skipped.`);
        return [];
      }
      players[String(id)] = p;
      return [{ playerId: id, lineupSlotId: null }];
    });
    return { id: t.id, name: t.name, abbrev: null, roster };
  });

  return {
    source: "custom",
    sourceLabel: "ESPN player projections (no league linked)",
    fetchedAt: now.toISOString(),
    rosterScoringPeriod: null,
    settings: {
      leagueId: "custom",
      name: league.name,
      sport: league.sport,
      season: league.season,
      scoringType: "H2H_POINTS",
      scoringLabel: `Points · ${preset.label}`,
      teamCount: league.teams.length,
      keeperCount: 0,
      slots: preset.slots,
      scoringItems: preset.scoringItems,
      activeRosterLimit,
      irSlotCount: preset.slots.filter((s) => s.kind === "ir").reduce((a, s) => a + s.count, 0),
      currentMatchupPeriod: null,
      currentScoringPeriod: null,
      finalScoringPeriod: null,
      matchupPeriods: null,
    },
    format: { supported: true },
    teams,
    players,
    // Replacement players are added directly to a team in the league builder, so
    // no free-agent list is exposed during trade analysis.
    freeAgents: unavailable("In a custom league, add replacement players to the team in the league builder. Open roster spots are treated as empty."),
    proSchedule: unavailable("Full-season projections do not use a game schedule."),
    warnings: [...new Set(warnings)],
  };
}
