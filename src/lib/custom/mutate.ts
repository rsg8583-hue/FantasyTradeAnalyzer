import type { CustomAction, TradeRequest } from "@/lib/domain/apiSchemas";
import { AppError } from "@/lib/domain/errors";
import { presetById } from "@/lib/league/presets";
import type { CustomLeague } from "./types";

export const MAX_TEAMS = 16;

/** Total roster size a team may hold (starters + bench + IR) for the league's preset. */
export function maxRosterSize(league: CustomLeague): number {
  const preset = presetById(league.presetId);
  return preset ? preset.slots.reduce((a, s) => a + s.count, 0) : 0;
}

/**
 * Applies one edit to the league, mutating it in place. `playerExists` checks
 * the live ESPN pool. Throws AppError (user-safe) on invalid edits.
 */
export function applyAction(league: CustomLeague, action: CustomAction, playerExists: (id: number) => boolean): void {
  const team = (id: number) => {
    const t = league.teams.find((x) => x.id === id);
    if (!t) throw new AppError("BAD_REQUEST", "That team is no longer in the league.");
    return t;
  };

  switch (action.action) {
    case "addTeam": {
      if (league.teams.length >= MAX_TEAMS) throw new AppError("BAD_REQUEST", `A league can have at most ${MAX_TEAMS} teams.`);
      if (league.teams.some((t) => t.name.toLowerCase() === action.name.toLowerCase())) {
        throw new AppError("BAD_REQUEST", "A team with that name already exists.");
      }
      league.teams.push({ id: league.nextTeamId++, name: action.name, playerIds: [] });
      return;
    }
    case "renameTeam": {
      const t = team(action.teamId);
      if (league.teams.some((o) => o.id !== t.id && o.name.toLowerCase() === action.name.toLowerCase())) {
        throw new AppError("BAD_REQUEST", "A team with that name already exists.");
      }
      t.name = action.name;
      return;
    }
    case "removeTeam": {
      team(action.teamId);
      league.teams = league.teams.filter((t) => t.id !== action.teamId);
      return;
    }
    case "addPlayer": {
      const t = team(action.teamId);
      if (!playerExists(action.playerId)) {
        throw new AppError("BAD_REQUEST", "That player is not in ESPN's projection pool.");
      }
      if (league.teams.some((o) => o.playerIds.includes(action.playerId))) {
        throw new AppError("CONFLICT", "That player is already on a team in this league.");
      }
      if (t.playerIds.length >= maxRosterSize(league)) {
        throw new AppError("BAD_REQUEST", `A team can hold at most ${maxRosterSize(league)} players. Remove one first.`);
      }
      t.playerIds.push(action.playerId);
      return;
    }
    case "removePlayer": {
      const t = team(action.teamId);
      t.playerIds = t.playerIds.filter((id) => id !== action.playerId);
      return;
    }
    case "trade":
      applyTrade(league, action.trade);
      return;
  }
}

/**
 * Moves traded players between the two rosters and removes each team's drops.
 * The caller validates the trade with planTrade first; this re-checks what it
 * relies on so a bad request can never duplicate or lose a player.
 */
function applyTrade(league: CustomLeague, trade: TradeRequest): void {
  const a = league.teams.find((t) => t.id === trade.teamA.teamId);
  const b = league.teams.find((t) => t.id === trade.teamB.teamId);
  if (!a || !b || a === b) throw new AppError("BAD_REQUEST", "Select two different teams from this league.");
  if (trade.teamA.adds.length > 0 || trade.teamB.adds.length > 0) {
    throw new AppError("BAD_REQUEST", "Add replacement players in the league builder instead.");
  }
  const after = (own: typeof a, side: TradeRequest["teamA"], other: TradeRequest["teamA"]) => {
    if (side.sends.some((id) => !own.playerIds.includes(id))) {
      throw new AppError("CONFLICT", `${own.name}'s roster changed. Re-analyze the trade before making it.`);
    }
    const leaving = new Set([...side.sends, ...side.drops]);
    const roster = [...own.playerIds.filter((id) => !leaving.has(id)), ...other.sends.filter((id) => !side.drops.includes(id))];
    if (roster.length > maxRosterSize(league)) {
      throw new AppError("BAD_REQUEST", `${own.name} would have more than ${maxRosterSize(league)} players.`);
    }
    return roster;
  };
  const rosterA = after(a, trade.teamA, trade.teamB);
  const rosterB = after(b, trade.teamB, trade.teamA);
  a.playerIds = rosterA;
  b.playerIds = rosterB;
}

export function newCustomLeague(input: { name: string; sport: CustomLeague["sport"]; season: number; presetId: string }): CustomLeague {
  return { ...input, nextTeamId: 1, teams: [] };
}
