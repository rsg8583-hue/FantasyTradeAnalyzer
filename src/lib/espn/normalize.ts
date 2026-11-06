import type {
  DataAvailability,
  FantasyTeam,
  FormatSupport,
  LeagueSettings,
  Player,
  PlayerProjectionData,
  ProSchedule,
  RosterSlot,
  ScoringItem,
  Sport,
  StatSplit,
} from "@/lib/domain/types";
import {
  BASKETBALL_POSITION_SLOTS,
  CATEGORY_SCORING_TYPES,
  FOOTBALL_POSITION_PRIORITY,
  NBA_TEAMS,
  NFL_TEAMS,
  STAT_SOURCE_PROJECTED,
  SUPPORTED_SCORING_TYPES,
  slotTable,
} from "./constants";
import type {
  RawLeagueSettingsResponse,
  RawLeagueTeamsResponse,
  RawPlayer,
  RawPlayerPoolResponse,
  RawProScheduleResponse,
  RawStatSplit,
} from "./schemas";

export function scoringLabel(scoringType: string | null): string {
  switch (scoringType) {
    case "H2H_POINTS":
      return "Head-to-head points";
    case "H2H_CATEGORY":
      return "Head-to-head categories (each category)";
    case "H2H_MOST_CATEGORIES":
      return "Head-to-head categories (most categories)";
    case "ROTO":
      return "Rotisserie";
    case null:
      return "Unknown scoring type";
    default:
      return scoringType;
  }
}

export function detectFormat(settings: LeagueSettings): FormatSupport {
  const reasons: string[] = [];
  const st = settings.scoringType;
  if (st === null) {
    reasons.push(
      "ESPN did not report a scoring type for this league, so it cannot be confirmed as a points league. Category and points leagues need different models; this app only models points leagues.",
    );
  } else if (CATEGORY_SCORING_TYPES.has(st)) {
    reasons.push(
      `This is a ${scoringLabel(st).toLowerCase()} league. Category formats are decided by winning individual stat categories, which a projected-points model cannot measure, so trade percentages would be misleading.`,
    );
  } else if (!SUPPORTED_SCORING_TYPES.has(st)) {
    reasons.push(
      `Scoring type "${st}" is not a verified head-to-head points format. Only H2H points leagues are supported in this version.`,
    );
  }
  if (settings.keeperCount === null) {
    reasons.push(
      "ESPN did not report keeper settings, so the league cannot be confirmed as redraft.",
    );
  } else if (settings.keeperCount > 0) {
    reasons.push(
      `This league keeps ${settings.keeperCount} player(s) per team (keeper or dynasty). Trade value in keeper/dynasty leagues depends on future seasons, which a single-period projection model does not capture.`,
    );
  }
  if (settings.scoringItems.length === 0 && reasons.length === 0) {
    reasons.push("ESPN did not return scoring rules for this league.");
  }
  if (!settings.slots.some((s) => s.kind === "starter" && s.count > 0)) {
    reasons.push("ESPN did not return any starting lineup slots for this league.");
  }
  return reasons.length === 0 ? { supported: true } : { supported: false, reasons };
}

export function normalizeSettings(
  raw: RawLeagueSettingsResponse,
  sport: Sport,
  season: number,
  leagueId: string,
): { settings: LeagueSettings; warnings: string[] } {
  const warnings: string[] = [];
  const table = slotTable(sport);
  const counts = raw.settings.rosterSettings?.lineupSlotCounts ?? {};
  const slots: RosterSlot[] = [];
  for (const [key, count] of Object.entries(counts)) {
    const slotId = Number(key);
    if (!Number.isInteger(slotId) || count <= 0) continue;
    const info = table[slotId];
    if (!info) {
      warnings.push(
        `Unrecognized roster slot id ${slotId} (count ${count}) was ignored; lineups may be incomplete.`,
      );
      continue;
    }
    if (info.kind === "ignore") continue;
    slots.push({ slotId, name: info.name, count, kind: info.kind });
  }
  slots.sort((a, b) => a.slotId - b.slotId);

  const scoringItems: ScoringItem[] = (raw.settings.scoringSettings?.scoringItems ?? [])
    .filter((i) => typeof i.points === "number" || i.pointsOverrides)
    .map((i) => ({
      statId: i.statId,
      points: i.points ?? 0,
      pointsOverrides: i.pointsOverrides ?? {},
    }));

  const scoringType = raw.settings.scoringSettings?.scoringType ?? null;
  const activeRosterLimit = slots
    .filter((s) => s.kind !== "ir")
    .reduce((sum, s) => sum + s.count, 0);
  const irSlotCount = slots
    .filter((s) => s.kind === "ir")
    .reduce((sum, s) => sum + s.count, 0);

  const matchupPeriods = raw.settings.scheduleSettings?.matchupPeriods ?? null;
  if (!matchupPeriods) {
    warnings.push("ESPN did not return the matchup-period calendar.");
  }

  return {
    warnings,
    settings: {
      leagueId,
      name: raw.settings.name ?? `League ${leagueId}`,
      sport,
      season,
      scoringType,
      scoringLabel: scoringLabel(scoringType),
      teamCount: raw.settings.size ?? 0,
      keeperCount: raw.settings.draftSettings?.keeperCount ?? null,
      slots,
      scoringItems,
      activeRosterLimit,
      irSlotCount,
      currentMatchupPeriod: raw.status?.currentMatchupPeriod ?? null,
      currentScoringPeriod: raw.scoringPeriodId ?? null,
      finalScoringPeriod: raw.status?.finalScoringPeriod ?? null,
      matchupPeriods,
    },
  };
}

function toSplit(raw: RawStatSplit): StatSplit {
  return {
    appliedTotal: raw.appliedTotal ?? null,
    appliedAverage: raw.appliedAverage ?? null,
    stats: raw.stats ?? null,
    averageStats: raw.averageStats ?? null,
  };
}

/**
 * Extracts projected splits. Per espn-api: statSourceId 0 = actual, otherwise
 * projected; scoringPeriodId 0 = season aggregate; statSplitTypeId 2 skipped.
 */
export function extractProjections(
  splits: RawStatSplit[] | undefined,
  season: number,
): PlayerProjectionData {
  const out: PlayerProjectionData = { byScoringPeriod: {}, season: null };
  for (const s of splits ?? []) {
    if (s.seasonId !== season) continue;
    if (s.statSourceId !== STAT_SOURCE_PROJECTED) continue;
    if (s.statSplitTypeId === 2) continue;
    if (s.scoringPeriodId === undefined) continue;
    if (s.scoringPeriodId === 0) out.season = toSplit(s);
    else out.byScoringPeriod[String(s.scoringPeriodId)] = toSplit(s);
  }
  return out;
}

export function normalizePlayer(raw: RawPlayer, sport: Sport, season: number): Player {
  const eligible = raw.eligibleSlots ?? [];
  const table = slotTable(sport);
  let positionSlotId: number | null = null;
  if (sport === "football") {
    positionSlotId = FOOTBALL_POSITION_PRIORITY.find((id) => eligible.includes(id)) ?? null;
  } else if (raw.defaultPositionId !== undefined) {
    positionSlotId = BASKETBALL_POSITION_SLOTS[raw.defaultPositionId - 1] ?? null;
  }
  const teams = sport === "football" ? NFL_TEAMS : NBA_TEAMS;
  return {
    id: raw.id,
    name: raw.fullName ?? `Player ${raw.id}`,
    position: positionSlotId !== null ? table[positionSlotId]?.name ?? "?" : "?",
    positionSlotId,
    eligibleSlotIds: eligible,
    proTeamId: raw.proTeamId ?? null,
    proTeamAbbrev: raw.proTeamId !== undefined ? teams[raw.proTeamId] ?? null : null,
    injuryStatus: raw.injuryStatus ?? null,
    projections: extractProjections(raw.stats, season),
  };
}

export function normalizeTeams(
  raw: RawLeagueTeamsResponse,
  sport: Sport,
  season: number,
): { teams: FantasyTeam[]; players: Record<string, Player>; warnings: string[] } {
  const players: Record<string, Player> = {};
  const warnings: string[] = [];
  const teams: FantasyTeam[] = raw.teams.map((t) => {
    const name =
      t.name?.trim() ||
      [t.location, t.nickname].filter(Boolean).join(" ").trim() ||
      `Team ${t.id}`;
    const entries = t.roster?.entries;
    if (!entries) warnings.push(`ESPN returned no roster for ${name}.`);
    const roster = (entries ?? []).flatMap((e) => {
      const rawPlayer = e.playerPoolEntry?.player;
      const playerId = e.playerId ?? rawPlayer?.id;
      if (playerId === undefined) return [];
      if (rawPlayer) {
        const p = normalizePlayer(rawPlayer, sport, season);
        if (p.injuryStatus === null && e.injuryStatus) p.injuryStatus = e.injuryStatus;
        players[String(playerId)] = p;
      } else {
        warnings.push(`Player ${playerId} on ${name} had no player details.`);
      }
      return [{ playerId, lineupSlotId: e.lineupSlotId ?? null }];
    });
    return { id: t.id, name, abbrev: t.abbrev ?? null, roster };
  });
  return { teams, players, warnings };
}

export function normalizeFreeAgents(
  raw: RawPlayerPoolResponse,
  sport: Sport,
  season: number,
): { ids: number[]; players: Record<string, Player> } {
  const players: Record<string, Player> = {};
  const ids: number[] = [];
  for (const entry of raw.players) {
    if (entry.onTeamId !== undefined && entry.onTeamId !== 0) continue;
    const p = normalizePlayer(entry.player, sport, season);
    players[String(p.id)] = p;
    ids.push(p.id);
  }
  return { ids, players };
}

export function normalizeProSchedule(raw: RawProScheduleResponse): ProSchedule {
  const gamesByTeam: ProSchedule["gamesByTeam"] = {};
  for (const team of raw.settings.proTeams) {
    const perPeriod: Record<string, number> = {};
    for (const [period, games] of Object.entries(team.proGamesByScoringPeriod ?? {})) {
      perPeriod[period] = games.length;
    }
    gamesByTeam[String(team.id)] = perPeriod;
  }
  return { gamesByTeam };
}

export function unavailable<T>(reason: string): DataAvailability<T> {
  return { status: "unavailable", reason };
}
