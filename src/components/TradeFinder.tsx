"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { formatDelta, formatPct } from "@/lib/client/format";
import type { LeagueSnapshot } from "@/lib/domain/types";
import type { RecommendResult, TradeSuggestion } from "@/lib/engine/recommend";
import type { ProjectionSet } from "@/lib/projections/types";
import { InjuryBadge, PlayerLabel, ProjectionCell } from "./PlayerBits";
import { Alert, Badge, Button, Card, SectionTitle, Spinner, cx } from "./ui";

interface Props {
  snapshot: LeagueSnapshot;
  projections: ProjectionSet;
  /** Loads a suggestion into the trade builder and analyzes it. */
  onOpen: (teamId: number, offer: number[], s: TradeSuggestion) => void;
  onSessionError: (e: unknown) => boolean;
}

type View = "fair" | "bestForMe";

const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const selectClass = "rounded-full border border-line px-3 py-1.5 text-sm font-medium";

/** Pick players to offer; the server searches other rosters for packages to ask for in return. */
export function TradeFinder({ snapshot, projections, onOpen, onSessionError }: Props) {
  const [teamId, setTeamId] = useState<number | null>(snapshot.teams[0]?.id ?? null);
  const [offer, setOffer] = useState<number[]>([]);
  const [partnerTeamId, setPartnerTeamId] = useState<number | null>(null);
  const [maxReceive, setMaxReceive] = useState(2);
  const [view, setView] = useState<View>("fair");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(RecommendResult & { snapshotFetchedAt: string; teamId: number; offer: number[] }) | null>(null);

  const team = snapshot.teams.find((t) => t.id === teamId) ?? null;
  const byPlayer = projections.status === "available" ? projections.byPlayer : {};
  const sport = snapshot.settings.sport;
  const p = (id: number) => snapshot.players[String(id)];
  const name = (id: number) => p(id)?.name ?? `Player ${id}`;
  // Results computed against older rosters can't be opened.
  const stale = result !== null && result.snapshotFetchedAt !== snapshot.fetchedAt;

  function pickTeam(id: number | null) {
    setTeamId(id);
    setOffer([]);
    setResult(null);
    if (id === partnerTeamId) setPartnerTeamId(null);
  }

  async function find() {
    if (teamId === null || offer.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.recommend({ teamId, offer, partnerTeamId, maxReceive });
      setResult({ ...r, teamId, offer });
      setView("fair");
    } catch (e) {
      if (!onSessionError(e)) setError(e instanceof ApiError ? e.message : "Could not search for trades.");
    } finally {
      setBusy(false);
    }
  }

  const list = result ? result[view] : [];

  return (
    <div className="space-y-4">
      <Card aria-labelledby="finder-heading">
        <SectionTitle id="finder-heading">Find a trade</SectionTitle>
        <p className="mt-1 text-sm text-fg-soft">
          Pick the players you&apos;d trade away. Every package of players from the other teams is scored with the same lineup math as trade analysis.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="font-medium">Your team</span>
            <select className={selectClass} value={teamId ?? ""} onChange={(e) => pickTeam(e.target.value === "" ? null : Number(e.target.value))}>
              {snapshot.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="font-medium">Trade with</span>
            <select className={selectClass} value={partnerTeamId ?? ""} onChange={(e) => setPartnerTeamId(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Any team</option>
              {snapshot.teams.filter((t) => t.id !== teamId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">Players to get back</legend>
            <span aria-hidden="true" className="font-medium">Get back up to</span>
            <div className="inline-flex gap-1 rounded-full bg-muted p-1">
              {[1, 2, 3].map((n) => (
                <label key={n} className={cx(
                  "cursor-pointer rounded-full px-3 py-1 font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                  maxReceive === n ? "bg-navy text-navy-fg" : "text-fg-soft hover:text-fg",
                )}>
                  <input type="radio" name="max-receive" className="sr-only" checked={maxReceive === n} onChange={() => setMaxReceive(n)} />
                  {n} {n === 1 ? "player" : "players"}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {!team ? (
          <p className="mt-4 text-sm text-fg-soft">Choose your team.</p>
        ) : team.roster.length === 0 ? (
          <p className="mt-4 text-sm text-fg-soft">{team.name} has no players yet.</p>
        ) : (
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-medium">Players to offer</legend>
            <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line">
              {team.roster.map((r) => {
                const checked = offer.includes(r.playerId);
                return (
                  <li key={r.playerId}>
                    <label className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted", checked && "bg-gold/20 shadow-[inset_3px_0_0_var(--gold-strong)]")}>
                      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} onChange={() => setOffer(toggle(offer, r.playerId))} />
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        <PlayerLabel player={p(r.playerId)} />
                        <InjuryBadge status={p(r.playerId)?.injuryStatus ?? null} />
                        {checked && <span className="rounded-full bg-navy px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">Offering</span>}
                      </span>
                      <ProjectionCell proj={byPlayer[String(r.playerId)]} sport={sport} />
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="cta" className="px-6 py-2.5" disabled={busy || offer.length === 0 || snapshot.teams.length < 2} onClick={() => void find()}>
            {busy ? "Searching…" : "Find trades"}
          </Button>
          {busy && <Spinner label="Scoring every possible package…" />}
          {!busy && offer.length === 0 && <span className="text-sm text-fg-soft">Select at least one player to offer.</span>}
        </div>
        {error && <div className="mt-3"><Alert tone="bad" role="alert" title="Search failed">{error}</Alert></div>}
      </Card>

      {result && (
        <section aria-labelledby="suggestions-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="suggestions-heading" className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <span aria-hidden="true" className="h-5 w-1.5 rounded-full bg-gold" />
              Suggested trades for {result.offer.map(name).join(", ")}
            </h2>
            <div role="tablist" aria-label="Suggestion ranking" className="inline-flex gap-1 rounded-full border border-line bg-surface p-1">
              {([["fair", "Fairest"], ["bestForMe", "Best for me"]] as const).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={cx("rounded-full px-3 py-1.5 text-sm font-semibold", view === v ? "bg-navy text-navy-fg" : "text-fg-soft hover:bg-muted")}>
                  {label} <span className="font-normal opacity-75">{result[v].length}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-fg-soft">
            Checked {result.evaluated.toLocaleString()} possible trades. All of these raise your projected lineup. {view === "fair"
              ? "Ranked so the other team comes out as well as possible; trades both teams gain from come first, and those are the most likely to be accepted."
              : "Ranked by how much they raise your lineup, whatever they do to the other team."}{" "}
            When a roster would be over its limit, its lowest-projected player is dropped.
          </p>
          {stale && (
            <Alert tone="warn" role="status" title="Rosters changed since this search" action={<Button onClick={() => void find()}>Search again</Button>}>
              These suggestions use earlier rosters, so they can&apos;t be opened.
            </Alert>
          )}

          {list.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-line bg-surface/60 p-6 text-center text-sm text-fg-soft">
              No trade for these players raises your projected lineup. Try getting back more players, another trade partner, or offering different players.
            </p>
          ) : (
            <ol className="grid gap-3 lg:grid-cols-2">
              {list.map((s, i) => (
                <li key={`${s.partnerTeamId}-${s.receive.join("-")}`}>
                  <SuggestionCard rank={i + 1} s={s} name={name} p={p} byPlayer={byPlayer} sport={sport} myTeam={team?.name ?? "You"}
                    disabled={stale} onOpen={() => onOpen(result.teamId, result.offer, s)} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

function Delta({ label, delta, pct }: { label: string; delta: number; pct: number | null }) {
  const up = delta > 0.05, down = delta < -0.05;
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-fg-soft">{label}</p>
      <p className={cx("text-lg font-bold tabular-nums", up ? "text-good" : down ? "text-bad" : "text-fg")}>
        <span aria-hidden="true">{up ? "▲ " : down ? "▼ " : ""}</span>
        {formatDelta(delta)} pts
      </p>
      {pct !== null && <p className="text-xs tabular-nums text-fg-soft">{formatPct(pct)}</p>}
    </div>
  );
}

function SuggestionCard({ rank, s, name, p, byPlayer, sport, myTeam, disabled, onOpen }: {
  rank: number;
  s: TradeSuggestion;
  name: (id: number) => string;
  p: (id: number) => LeagueSnapshot["players"][string] | undefined;
  byPlayer: Extract<ProjectionSet, { status: "available" }>["byPlayer"];
  sport: "football" | "basketball";
  myTeam: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <Card as="article" className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm">
          <span className="mr-2 inline-grid size-6 place-items-center rounded-full bg-navy text-xs font-bold text-gold">{rank}</span>
          With <strong>{s.partnerTeamName}</strong>
        </p>
        {s.bothImprove && <Badge tone="good">Both improve</Badge>}
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-fg-soft">You get</p>
        <ul className="mt-1 space-y-1 text-sm">
          {s.receive.map((id) => (
            <li key={id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1"><PlayerLabel player={p(id)} /> <InjuryBadge status={p(id)?.injuryStatus ?? null} /></span>
              <ProjectionCell proj={byPlayer[String(id)]} sport={sport} />
            </li>
          ))}
        </ul>
      </div>
      {(s.myDrops.length > 0 || s.partnerDrops.length > 0) && (
        <p className="text-xs text-fg-soft">
          {s.myDrops.length > 0 && <>You drop {s.myDrops.map(name).join(", ")}. </>}
          {s.partnerDrops.length > 0 && <>{s.partnerTeamName} drops {s.partnerDrops.map(name).join(", ")}.</>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-3">
        <Delta label={myTeam} delta={s.myDelta} pct={s.myPct} />
        <Delta label={s.partnerTeamName} delta={s.partnerDelta} pct={s.partnerPct} />
      </div>
      <Button variant="primary" className="mt-auto self-start" disabled={disabled} onClick={onOpen}>Open in trade builder</Button>
    </Card>
  );
}
