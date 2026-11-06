"use client";

import type { ExplanationResult } from "@/lib/ai/schema";
import type { TeamTradeResult, TradeAnalysis } from "@/lib/engine/types";
import { VERDICT_LABEL } from "@/lib/engine/types";
import { absoluteTime, direction, formatDelta, formatPct, formatPoints } from "@/lib/client/format";
import { ExplanationPanel } from "./ExplanationPanel";
import { Methodology } from "./Methodology";
import { Alert, Badge, Button, Card, cx } from "./ui";

const VERDICT_ICON = { both_improve: "▲▲", one_improves: "▲▼", neither_improves: "▼▼", insufficient_data: "?" } as const;

interface Props {
  analysis: TradeAnalysis;
  outdated: boolean;
  onReanalyze: () => void;
  explanation: { status: "idle" | "loading" } | { status: "done"; result: ExplanationResult } | { status: "error"; message: string };
  /** Present only where trades can be carried out (custom leagues). */
  onMakeTrade?: () => void;
  making?: boolean;
  makeError?: string | null;
}

export function TradeResults({ analysis, outdated, onReanalyze, explanation, onMakeTrade, making = false, makeError = null }: Props) {
  const name = (id: number) => analysis.players[String(id)]?.name ?? `Player ${id}`;
  return (
    <section aria-labelledby="results-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="results-heading" className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <span aria-hidden="true" className="h-6 w-1.5 rounded-full bg-gold" />
          Trade analysis
        </h2>
        <p className="text-xs text-fg-soft">Calculated {absoluteTime(analysis.computedAt)} from data synced {absoluteTime(analysis.snapshotFetchedAt)}</p>
      </div>

      {outdated && (
        <Alert tone="warn" role="status" title="League data changed since this analysis" action={<Button onClick={onReanalyze}>Re-analyze with current data</Button>}>
          These results use an earlier snapshot.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="hero-band rounded-2xl p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">Projection window</p>
          <p className="mt-1 text-xl font-bold">{analysis.horizon.label}</p>
          <p className="mt-2 text-sm text-navy-soft">{analysis.horizon.note}</p>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-gold p-5 text-gold-fg shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Verdict · projection-based estimate</p>
          <p className="mt-1 flex items-center gap-3 text-2xl font-bold">
            <span aria-hidden="true" className="font-mono text-lg">{VERDICT_ICON[analysis.verdict]}</span>
            {VERDICT_LABEL[analysis.verdict]}
          </p>
          <p className="mt-2 text-xs opacity-80">
            Short-term projected lineup change for this window only. Not a win probability, season-long value, or judgment of fairness.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {analysis.teams.map((t) => <ResultCard key={t.side} t={t} name={name} />)}
      </div>

      {onMakeTrade && !outdated && (
        <Card aria-labelledby="make-trade-heading" className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 id="make-trade-heading" className="font-semibold">Make this trade</h3>
            <p className="text-sm text-fg-soft">
              Moves the players between {analysis.teams[0].teamName} and {analysis.teams[1].teamName}
              {analysis.teams.some((t) => t.drops.length > 0) ? " and removes the dropped players" : ""}. Rosters update right away.
            </p>
          </div>
          <Button variant="primary" className="px-5" disabled={making} onClick={onMakeTrade}>
            {making ? "Making trade…" : "Make this trade"}
          </Button>
          {makeError && <div className="w-full"><Alert tone="bad" role="alert" title="Trade not made">{makeError}</Alert></div>}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {analysis.teams.map((t) => <LineupComparison key={t.side} t={t} analysis={analysis} />)}
      </div>

      <ExplanationPanel analysis={analysis} state={explanation} />

      {(analysis.assumptions.length > 0 || analysis.limitations.length > 0) && (
        <Card aria-labelledby="assumptions-heading">
          <h3 id="assumptions-heading" className="font-semibold">Assumptions and limitations</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-soft">
            {[...new Set([...analysis.assumptions, ...analysis.limitations])].map((a) => <li key={a}>{a}</li>)}
          </ul>
          <p className="mt-3 text-xs text-fg-soft">
            Projection inputs: {analysis.projectionSource}, fetched {absoluteTime(analysis.projectionFetchedAt)}.
          </p>
        </Card>
      )}

      <Methodology analysis={analysis} />
    </section>
  );
}

function ResultCard({ t, name }: { t: TeamTradeResult; name: (id: number) => string }) {
  const dir = direction(t.percentChange);
  const words = { up: "Improves", down: "Declines", flat: "No change", na: "Not available" }[dir];
  const icon = { up: "▲", down: "▼", flat: "■", na: "?" }[dir];
  const color = { up: "text-good", down: "text-bad", flat: "text-fg", na: "text-fg-soft" }[dir];
  return (
    <Card as="article" aria-labelledby={`team-${t.side}-h`} className={cx("border-t-4", t.side === "A" ? "border-t-accent" : "border-t-gold")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-fg-soft">Team {t.side}</p>
          <h3 id={`team-${t.side}-h`} className="truncate text-lg font-semibold">{t.teamName}</h3>
        </div>
        <Badge tone={dir === "up" ? "good" : dir === "down" ? "bad" : "neutral"}>
          <span aria-hidden="true">{icon}</span> {words}
        </Badge>
      </div>

      <p className="mt-3 text-xs text-fg-soft">Projected starting-lineup change</p>
      <p className={cx("text-5xl font-bold tracking-tight tabular-nums", color)}>
        {t.percentChange === null ? "Not available" : formatPct(t.percentChange)}
      </p>
      {t.pointsBefore !== null && t.pointsAfter !== null && t.pointDelta !== null ? (
        <p className="mt-1 text-sm tabular-nums">
          {formatPoints(t.pointsBefore)} → {formatPoints(t.pointsAfter)} projected pts{" "}
          <span className="font-medium">({formatDelta(t.pointDelta)} pts)</span>
        </p>
      ) : null}
      {t.insufficientReasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-fg-soft">{t.insufficientReasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      <p className="mt-2 text-xs text-fg-soft">Projection-based estimate. Not a change in win probability.</p>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-muted p-3 text-sm">
        <dt className="text-fg-soft">Sends</dt><dd>{t.sent.map(name).join(", ") || "—"}</dd>
        <dt className="text-fg-soft">Receives</dt><dd>{t.received.map(name).join(", ") || "—"}</dd>
        {t.drops.length > 0 && (<><dt className="text-fg-soft">Drops</dt><dd>{t.drops.map(name).join(", ")}</dd></>)}
        {t.adds.length > 0 && (<><dt className="text-fg-soft">Adds</dt><dd>{t.adds.map(name).join(", ")}</dd></>)}
        {t.openSpotsAfter > 0 && (<><dt className="text-fg-soft">Open spots</dt><dd>{t.openSpotsAfter} (treated as empty)</dd></>)}
      </dl>

      {t.warnings.length > 0 && (
        <div className="mt-3">
          <Alert tone="warn">
            <ul className="list-disc pl-4">{t.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </Alert>
        </div>
      )}
    </Card>
  );
}

function LineupComparison({ t, analysis }: { t: TeamTradeResult; analysis: TradeAnalysis }) {
  const nm = (id: number | null) => (id === null ? null : analysis.players[String(id)]?.name ?? `Player ${id}`);
  const single = t.before.periods.length === 1 && t.after.periods.length === 1;

  if (single) {
    const b = t.before.periods[0].slots;
    const a = t.after.periods[0].slots;
    return (
      <Card aria-labelledby={`lineup-${t.side}`}>
        <h3 id={`lineup-${t.side}`} className="font-semibold">{t.teamName}: optimal lineup before vs. after</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="sr-only">Projected starting lineup before and after the trade for {t.teamName}</caption>
            <thead>
              <tr className="border-b border-line bg-muted text-left text-xs uppercase tracking-wide text-fg-soft">
                <th scope="col" className="py-1.5 pr-2 font-medium">Slot</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Before</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">After</th>
                <th scope="col" className="py-1.5 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {b.map((slot, i) => {
                const after = a[i];
                const changed = slot.playerId !== after?.playerId;
                const d = (after?.points ?? 0) - slot.points;
                return (
                  <tr key={i} className={cx("border-b border-line/60", changed && "bg-gold/15")}>
                    <th scope="row" className="py-1.5 pr-2 text-left font-medium">{slot.slotName}</th>
                    <td className="py-1.5 pr-2">{nm(slot.playerId) ?? <em className="text-fg-soft">Empty</em>} <span className="tabular-nums text-fg-soft">{formatPoints(slot.points)}</span></td>
                    <td className="py-1.5 pr-2">
                      {nm(after?.playerId ?? null) ?? <em className="text-fg-soft">Empty</em>} <span className="tabular-nums text-fg-soft">{formatPoints(after?.points ?? 0)}</span>
                      {changed && <span className="sr-only"> (changed)</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{changed || Math.abs(d) > 0.05 ? formatDelta(d) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="py-1.5 pr-2 text-left">Total</th>
                <td className="py-1.5 pr-2 tabular-nums">{formatPoints(t.before.total)}</td>
                <td className="py-1.5 pr-2 tabular-nums">{formatPoints(t.after.total)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatDelta(t.after.total - t.before.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    );
  }

  // Multi-day window: aggregate starts and starter points per player.
  const usage = (which: "before" | "after") => {
    const m = new Map<number, { starts: number; pts: number }>();
    for (const p of t[which].periods) for (const s of p.slots) {
      if (s.playerId === null) continue;
      const u = m.get(s.playerId) ?? { starts: 0, pts: 0 };
      u.starts++;
      u.pts += s.points;
      m.set(s.playerId, u);
    }
    return m;
  };
  const ub = usage("before");
  const ua = usage("after");
  const ids = [...new Set([...ub.keys(), ...ua.keys()])].sort((x, y) => (ua.get(y)?.pts ?? ub.get(y)?.pts ?? 0) - (ua.get(x)?.pts ?? ub.get(x)?.pts ?? 0));
  return (
    <Card aria-labelledby={`lineup-${t.side}`}>
      <h3 id={`lineup-${t.side}`} className="font-semibold">{t.teamName}: daily optimal lineups, before vs. after</h3>
      <p className="mt-1 text-xs text-fg-soft">Starts and starter points summed over {t.before.periods.length} remaining day(s).</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="sr-only">Lineup usage before and after the trade for {t.teamName}</caption>
          <thead>
            <tr className="border-b border-line bg-muted text-left text-xs uppercase tracking-wide text-fg-soft">
              <th scope="col" className="py-1.5 pr-2 font-medium">Player</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-medium">Before (starts · pts)</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-medium">After (starts · pts)</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <tr key={id} className="border-b border-line/60">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">{nm(id)}</th>
                <td className="py-1.5 pr-2 text-right tabular-nums">{ub.has(id) ? `${ub.get(id)!.starts} · ${formatPoints(ub.get(id)!.pts)}` : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{ua.has(id) ? `${ua.get(id)!.starts} · ${formatPoints(ua.get(id)!.pts)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="py-1.5 pr-2 text-left">Total</th>
              <td className="py-1.5 pr-2 text-right tabular-nums">{formatPoints(t.before.total)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{formatPoints(t.after.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
