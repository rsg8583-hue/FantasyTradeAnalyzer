import type { LeagueSnapshot } from "@/lib/domain/types";
import type { TradeAnalysis, TeamTradeResult } from "@/lib/engine/types";
import { round1 } from "@/lib/engine/trade";

/**
 * Builds the minimal, credential-free payload sent to the AI provider. Team
 * and manager names are replaced with "Team A"/"Team B" (they are not needed
 * for analysis and may contain personal information). Only players involved in
 * the two rosters are included.
 */
export function buildAiInput(analysis: TradeAnalysis, snapshot: LeagueSnapshot) {
  const s = snapshot.settings;
  const label = (t: TeamTradeResult) => `Team ${t.side}`;
  const p = (id: number) => {
    const pl = analysis.players[String(id)];
    return pl
      ? {
          name: pl.name,
          position: pl.position,
          proTeam: pl.proTeam,
          injuryStatusReportedBySource: pl.injuryStatus,
          projectedPointsInWindow: pl.projectedTotal === null ? null : round1(pl.projectedTotal),
          gamesScheduledInWindow: pl.gamesScheduled,
          projectionMissingReason: pl.missingReason,
        }
      : { name: `Player ${id}`, projectionMissingReason: "unknown player" };
  };
  const lineup = (t: TeamTradeResult, which: "before" | "after") => {
    const ev = t[which];
    if (ev.periods.length === 1) {
      return ev.periods[0].slots.map((sl) => ({
        slot: sl.slotName,
        player: sl.playerId === null ? null : analysis.players[String(sl.playerId)]?.name ?? null,
        projectedPoints: round1(sl.points),
      }));
    }
    // Multi-day windows: summarize starts per player.
    const usage = new Map<number, { starts: number; points: number }>();
    for (const period of ev.periods) {
      for (const sl of period.slots) {
        if (sl.playerId === null) continue;
        const u = usage.get(sl.playerId) ?? { starts: 0, points: 0 };
        u.starts += 1;
        u.points += sl.points;
        usage.set(sl.playerId, u);
      }
    }
    return [...usage.entries()].map(([id, u]) => ({
      player: analysis.players[String(id)]?.name ?? `Player ${id}`,
      lineupStarts: u.starts,
      projectedPointsAsStarter: round1(u.points),
    }));
  };

  return {
    league: {
      sport: s.sport,
      scoringFormat: s.scoringLabel,
      scoringRules: s.scoringItems.map((i) => ({ statId: i.statId, points: i.points, positionOverrides: i.pointsOverrides })),
      startingSlots: s.slots.filter((x) => x.kind === "starter").map((x) => ({ slot: x.name, count: x.count })),
      benchSlots: s.slots.filter((x) => x.kind === "bench").reduce((a, x) => a + x.count, 0),
      activeRosterLimit: s.activeRosterLimit,
    },
    projectionWindow: {
      label: analysis.horizon.label,
      note: analysis.horizon.note,
      source: analysis.projectionSource,
      fetchedAt: analysis.projectionFetchedAt,
    },
    computedVerdict: analysis.verdict,
    teams: analysis.teams.map((t) => ({
      team: label(t),
      sends: t.sent.map(p),
      receives: t.received.map(p),
      drops: t.drops.map(p),
      addsFromFreeAgency: t.adds.map(p),
      openRosterSpotsAfter: t.openSpotsAfter,
      projectedLineupPointsBefore: t.pointsBefore === null ? null : round1(t.pointsBefore),
      projectedLineupPointsAfter: t.pointsAfter === null ? null : round1(t.pointsAfter),
      pointChange: t.pointDelta === null ? null : round1(t.pointDelta),
      percentChangeDisplayed: t.percentChange === null ? "not available" : formatPct(t.percentChange),
      insufficientDataReasons: t.insufficientReasons,
      lineupBefore: lineup(t, "before"),
      lineupAfter: lineup(t, "after"),
      warnings: t.warnings.map((w) => w.replaceAll(t.teamName, label(t))),
    })),
    assumptions: analysis.assumptions.map((a) => anonymize(a, analysis)),
    limitations: analysis.limitations.map((a) => anonymize(a, analysis)),
  };
}

function anonymize(text: string, analysis: TradeAnalysis): string {
  return analysis.teams.reduce((acc, t) => acc.replaceAll(t.teamName, `Team ${t.side}`), text);
}

/** Display format used everywhere: sign + one decimal + "%". */
export function formatPct(pct: number): string {
  const r = round1(pct);
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${Math.abs(r).toFixed(1)}%`;
}

export type AiInput = ReturnType<typeof buildAiInput>;
