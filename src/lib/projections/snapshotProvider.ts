import type { LeagueSnapshot, Player } from "@/lib/domain/types";
import { scoreSplit, type ScoredValue } from "./scoring";
import type {
  PlayerHorizonProjection,
  ProjectionHorizon,
  ProjectionProvider,
  ProjectionSet,
} from "./types";

const OUT_STATUSES = new Set(["OUT", "INJURY_RESERVE", "SUSPENSION"]);

function basisText(v: ScoredValue, what: string, sourceLabel: string): string {
  return v.basis === "provider-applied"
    ? `${sourceLabel} ${what} (scored by the source with this league's rules)`
    : `${sourceLabel} ${what} (projected stats scored with this league's rules)`;
}

export function selectHorizon(snapshot: LeagueSnapshot): ProjectionHorizon | { error: string } {
  const s = snapshot.settings;
  const current = snapshot.rosterScoringPeriod ?? s.currentScoringPeriod;
  if (current === null) {
    return { error: "The league did not report a current scoring period, so no projection window can be chosen." };
  }
  if (s.sport === "football") {
    return {
      kind: "current-matchup-period",
      label: `NFL week ${current} only (current scoring period)`,
      matchupPeriodId: s.currentMatchupPeriod,
      scoringPeriodIds: [current],
      note:
        "Full-week projection for this single week. It ignores games already played or locked this week and is not a rest-of-season or season-long trade value.",
    };
  }
  const mp = s.currentMatchupPeriod;
  const periods = mp !== null ? s.matchupPeriods?.[String(mp)] : undefined;
  if (!periods || periods.length === 0) {
    return { error: "The league did not report which days belong to the current matchup period." };
  }
  const remaining = periods.filter((p) => p >= current).sort((a, b) => a - b);
  if (remaining.length === 0) {
    return { error: "The current matchup period has no remaining scoring days." };
  }
  return {
    kind: "current-matchup-period",
    label: `Matchup period ${mp} only — remaining scoring days ${remaining[0]}–${remaining[remaining.length - 1]}`,
    matchupPeriodId: mp,
    scoringPeriodIds: remaining,
    note:
      "Per-game projections multiplied by each player's scheduled games on the remaining days of this matchup period, with an optimal lineup set each day. Includes today even if games have started. Ignores games-played limits. Not a rest-of-season or season-long trade value.",
  };
}

export class SnapshotProjectionProvider implements ProjectionProvider {
  readonly name = "snapshot";

  project(snapshot: LeagueSnapshot, playerIds: number[]): ProjectionSet {
    const sourceLabel = snapshot.source === "demo" ? "Demo fixture" : "ESPN";
    const base = { source: `${snapshot.sourceLabel} projections`, fetchedAt: snapshot.fetchedAt };
    const horizon = selectHorizon(snapshot);
    if ("error" in horizon) return { status: "unavailable", reason: horizon.error, ...base };

    const limitations: string[] = [];
    const byPlayer: Record<string, PlayerHorizonProjection> = {};
    const items = snapshot.settings.scoringItems;
    const schedule = snapshot.proSchedule.status === "available" ? snapshot.proSchedule.value : null;

    if (snapshot.settings.sport === "basketball" && !schedule) {
      return {
        status: "unavailable",
        reason: `Basketball projections need the pro schedule to count games, but it is unavailable. ${
          snapshot.proSchedule.status === "unavailable" ? snapshot.proSchedule.reason : ""
        }`.trim(),
        ...base,
      };
    }

    const gamesIn = (p: Player, period: number): number | null => {
      if (!schedule || p.proTeamId === null || p.proTeamId === 0) return null;
      const team = schedule.gamesByTeam[String(p.proTeamId)];
      if (!team) return null;
      return team[String(period)] ?? 0;
    };

    for (const id of playerIds) {
      const p = snapshot.players[String(id)];
      if (!p) {
        byPlayer[String(id)] = {
          perPeriod: horizon.scoringPeriodIds.map(() => null),
          total: null,
          basis: "none",
          missingReason: "Player details were not returned by the data source.",
          gamesScheduled: null,
        };
        continue;
      }

      if (snapshot.settings.sport === "football") {
        const week = horizon.scoringPeriodIds[0];
        const scored = scoreSplit(p.projections.byScoringPeriod[String(week)], "total", items, p.positionSlotId);
        const games = gamesIn(p, week);
        let value: number | null = null;
        let basis = "none";
        let missingReason: string | null = null;
        if (scored) {
          value = scored.points;
          basis = basisText(scored, `week ${week} projection`, sourceLabel);
        } else if (games === 0) {
          value = 0;
          basis = `No game scheduled in week ${week} (bye), per the pro schedule`;
        } else {
          missingReason = `No week ${week} projection was returned for this player.`;
        }
        byPlayer[String(id)] = {
          perPeriod: [value],
          total: value,
          basis,
          missingReason,
          gamesScheduled: games,
        };
        continue;
      }

      // Basketball: per-game projection x scheduled games, per day.
      const perGame = scoreSplit(p.projections.season, "average", items, p.positionSlotId);
      let totalGames = 0;
      let unknownSchedule = false;
      const perPeriod = horizon.scoringPeriodIds.map((day) => {
        const g = gamesIn(p, day);
        if (g === null) {
          unknownSchedule = true;
          return null;
        }
        totalGames += g;
        if (g === 0) return 0;
        return perGame ? perGame.points * g : null;
      });
      const missing = perPeriod.some((v) => v === null);
      let missingReason: string | null = null;
      if (unknownSchedule) missingReason = "This player's pro team schedule is unknown (free agent or unlisted team).";
      else if (missing) missingReason = "No per-game projection was returned for this player.";
      if (p.injuryStatus && OUT_STATUSES.has(p.injuryStatus) && totalGames > 0 && !missing) {
        limitations.push(
          `${p.name} is listed as ${p.injuryStatus} by ${sourceLabel}. The per-game projection is multiplied by scheduled games and does not know whether or when the player returns.`,
        );
      }
      byPlayer[String(id)] = {
        perPeriod,
        total: missing ? null : perPeriod.reduce<number>((a, b) => a + (b ?? 0), 0),
        basis: perGame
          ? basisText(perGame, "per-game season projection × scheduled games", sourceLabel)
          : "none",
        missingReason,
        gamesScheduled: unknownSchedule ? null : totalGames,
      };
    }

    return { status: "available", horizon, byPlayer, limitations, ...base };
  }
}
