"use client";

import { useId } from "react";
import type { LeagueSnapshot } from "@/lib/domain/types";
import type { ProjectionSet } from "@/lib/projections/types";
import { planTrade } from "@/lib/engine/trade";
import { emptySide, sideCounts, toRequest, type SideDraft, type TradeDraft } from "@/lib/client/draft";
import { InjuryBadge, PlayerLabel, ProjectionCell } from "./PlayerBits";
import { Alert, Badge, Button, Card, Spinner, cx } from "./ui";

interface Props {
  snapshot: LeagueSnapshot;
  projections: ProjectionSet;
  draft: TradeDraft;
  onChange: (d: TradeDraft) => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function TradeBuilder({ snapshot, projections, draft, onChange, onAnalyze, analyzing }: Props) {
  const req = toRequest(draft, snapshot);
  const live = req ? planTrade(snapshot, req) : null;
  const noPlayers = draft.a.sends.length === 0 && draft.b.sends.length === 0;
  const blocking = !req ? ["Select two teams."] : noPlayers ? ["Select at least one player to trade."] : live?.errors ?? [];
  const canAnalyze = blocking.length === 0 && snapshot.format.supported && projections.status === "available";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SidePanel label="Team A" snapshot={snapshot} projections={projections} own={draft.a} other={draft.b}
          onChange={(a) => onChange({ ...draft, a })} />
        <SidePanel label="Team B" snapshot={snapshot} projections={projections} own={draft.b} other={draft.a}
          onChange={(b) => onChange({ ...draft, b })} />
      </div>

      <div className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-2xl bg-navy p-4 text-navy-fg shadow-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm [&_.text-fg-soft]:text-navy-soft" aria-live="polite">
          {blocking.length > 0 && !noPlayers && req ? (
            <div>
              <p className="font-medium">Before analyzing:</p>
              <ul className="mt-1 list-disc pl-5 text-fg-soft">{blocking.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          ) : blocking.length > 0 ? (
            <p className="text-fg-soft">{blocking[0]}</p>
          ) : (
            <p className="text-fg-soft">Ready. Both lineups will be re-optimized for {projections.status === "available" ? projections.horizon.label : "the projection window"}.</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {analyzing && <Spinner label="Calculating…" />}
          <Button variant="cta" className="px-6 py-2.5 text-base" onClick={onAnalyze} disabled={!canAnalyze || analyzing}>Analyze trade</Button>
        </div>
      </div>
    </div>
  );
}

function SidePanel({ label, snapshot, projections, own, other, onChange }: {
  label: string;
  snapshot: LeagueSnapshot;
  projections: ProjectionSet;
  own: SideDraft;
  other: SideDraft;
  onChange: (s: SideDraft) => void;
}) {
  const uid = useId();
  const byPlayer = projections.status === "available" ? projections.byPlayer : {};
  const sport = snapshot.settings.sport;
  const team = snapshot.teams.find((t) => t.id === own.teamId);
  const counts = sideCounts(snapshot, own, other);
  const irSlots = new Set(snapshot.settings.slots.filter((s) => s.kind === "ir").map((s) => s.slotId));
  const p = (id: number) => snapshot.players[String(id)];
  const fa = snapshot.freeAgents;
  const otherAdds = new Set(other.adds);

  return (
    <Card aria-labelledby={`${uid}-h`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${uid}-h`} className="flex items-center gap-2 text-lg font-semibold">
          <span
            aria-hidden="true"
            className={cx(
              "grid size-8 place-items-center rounded-full text-sm font-black",
              label.endsWith("A") ? "bg-accent text-accent-fg" : "bg-gold text-gold-fg",
            )}
          >
            {label.slice(-1)}
          </span>
          {label}
        </h2>
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <span className="sr-only">{label} fantasy team</span>
          <select
            className="max-w-[16rem] rounded-full border border-line px-3 py-1.5 font-medium"
            value={own.teamId ?? ""}
            onChange={(e) => onChange({ ...emptySide(), teamId: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">Select a team…</option>
            {snapshot.teams.map((t) => (
              <option key={t.id} value={t.id} disabled={t.id === other.teamId}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!team ? (
        <p className="mt-4 text-sm text-fg-soft">Choose a team to see its roster.</p>
      ) : (
        <div className="mt-3 space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Players {team.name} sends</legend>
            {team.roster.length === 0 ? (
              <p className="text-sm text-fg-soft">This team has no players.</p>
            ) : (
              <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line">
                {team.roster.map((r) => {
                  const checked = own.sends.includes(r.playerId);
                  const onIr = r.lineupSlotId !== null && irSlots.has(r.lineupSlotId);
                  return (
                    <li key={r.playerId}>
                      <label className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted", checked && "bg-gold/20 shadow-[inset_3px_0_0_var(--gold-strong)]")}>
                        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked}
                          onChange={() => onChange({ ...own, sends: toggle(own.sends, r.playerId) })} />
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                          <PlayerLabel player={p(r.playerId)} />
                          {onIr && <Badge>IR</Badge>}
                          <InjuryBadge status={p(r.playerId)?.injuryStatus ?? null} />
                          {checked && <span className="rounded-full bg-navy px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">Sending</span>}
                        </span>
                        <ProjectionCell proj={byPlayer[String(r.playerId)]} sport={sport} />
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          {counts && (
            <div className="space-y-3 rounded-xl bg-muted p-3 text-sm">
              <p>
                Active roster: {counts.beforeActive.length} → <strong>{counts.postTrade.length - own.drops.length + own.adds.length}</strong> of {counts.effectiveLimit}
                {counts.requiredDrops > 0 && <span className="text-warn"> · must drop {counts.requiredDrops}</span>}
                {counts.openSpots - own.adds.length > 0 && <span className="text-fg-soft"> · {counts.openSpots - own.adds.length} open spot(s)</span>}
              </p>

              {counts.requiredDrops > 0 && (
                <fieldset>
                  <legend className="font-medium">
                    Choose {counts.requiredDrops} player(s) to drop ({own.drops.length}/{counts.requiredDrops} selected)
                  </legend>
                  <ul className="mt-2 space-y-1">
                    {counts.postTrade.map((id) => {
                      const checked = own.drops.includes(id);
                      const full = !checked && own.drops.length >= counts.requiredDrops;
                      return (
                        <li key={id}>
                          <label className={cx("flex items-center gap-3", full ? "opacity-50" : "cursor-pointer")}>
                            <input type="checkbox" className="size-4" checked={checked} disabled={full}
                              onChange={() => onChange({ ...own, drops: toggle(own.drops, id) })} />
                            <span className="flex-1"><PlayerLabel player={p(id)} />{other.sends.includes(id) && <span className="text-xs text-fg-soft"> (incoming)</span>}</span>
                            <ProjectionCell proj={byPlayer[String(id)]} sport={sport} />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}

              {counts.openSpots > 0 && (
                fa.status === "unavailable" ? (
                  <Alert tone="warn" title="Replacement data unavailable">
                    {fa.reason} Open roster spots will be treated as empty (scoring 0); any replacement value is not counted.
                  </Alert>
                ) : fa.value.length === 0 ? (
                  <p className="text-fg-soft">No free agents were returned, so open spots stay empty.</p>
                ) : (
                  <details>
                    <summary className="cursor-pointer font-medium">
                      Optional: add up to {counts.openSpots} replacement(s) from free agency ({own.adds.length} selected)
                    </summary>
                    <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto pr-1">
                      {fa.value.map((id) => {
                        const checked = own.adds.includes(id);
                        const disabled = (!checked && own.adds.length >= counts.openSpots) || otherAdds.has(id);
                        return (
                          <li key={id}>
                            <label className={cx("flex items-center gap-3", disabled ? "opacity-50" : "cursor-pointer")}>
                              <input type="checkbox" className="size-4" checked={checked} disabled={disabled}
                                onChange={() => onChange({ ...own, adds: toggle(own.adds, id) })} />
                              <span className="flex-1"><PlayerLabel player={p(id)} /></span>
                              <ProjectionCell proj={byPlayer[String(id)]} sport={sport} />
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-xs text-fg-soft">Assumes the free-agent claim succeeds. Waiver priority and budgets are not modeled.</p>
                  </details>
                )
              )}
            </div>
          )}

          {counts && (own.sends.length > 0 || other.sends.length > 0) && (
            <details className="text-sm" open>
              <summary className="cursor-pointer font-medium">Proposed roster after trade</summary>
              <ul className="mt-2 space-y-1">
                {[...counts.postTrade, ...own.adds].map((id) => {
                  const incoming = other.sends.includes(id) || own.adds.includes(id);
                  const dropped = own.drops.includes(id);
                  return (
                    <li key={id} className={cx("flex items-center gap-2", dropped && "text-fg-soft line-through")}>
                      <span aria-hidden="true" className="w-4 text-center">{incoming ? "+" : dropped ? "−" : "·"}</span>
                      <PlayerLabel player={p(id)} />
                      {incoming && <Badge tone="good">{own.adds.includes(id) ? "added" : "incoming"}</Badge>}
                      {dropped && <Badge tone="bad">dropped</Badge>}
                    </li>
                  );
                })}
                {own.sends.map((id) => (
                  <li key={`out-${id}`} className="flex items-center gap-2 text-fg-soft">
                    <span aria-hidden="true" className="w-4 text-center">−</span>
                    <span className="line-through"><PlayerLabel player={p(id)} /></span>
                    <Badge tone="bad">outgoing</Badge>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
