"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, SESSION_GONE } from "@/lib/client/api";
import type { CustomLeague } from "@/lib/custom/types";
import type { LeagueStateResponse } from "@/lib/domain/apiTypes";
import type { LeagueSnapshot } from "@/lib/domain/types";
import type { PlayerSearchResponse } from "@/lib/domain/apiTypes";
import { formatPoints } from "@/lib/client/format";
import { scoreSplit } from "@/lib/projections/scoring";
import { InjuryBadge } from "./PlayerBits";
import { Alert, Badge, Button, Card, SectionTitle, Spinner, cx } from "./ui";

interface Props {
  league: CustomLeague;
  snapshot: LeagueSnapshot;
  onState: (s: LeagueStateResponse) => void;
  onSessionGone: (code: string) => void;
}

/** Create/rename/remove teams and add/remove players from the live ESPN pool. */
export function LeagueBuilder({ league, snapshot, onState, onSessionGone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<number | null>(league.teams[0]?.id ?? null);
  const [newTeam, setNewTeam] = useState("");

  const activeTeam = league.teams.find((t) => t.id === activeTeamId) ?? league.teams[0] ?? null;
  const rosterLimit = snapshot.settings.slots.reduce((a, s) => a + s.count, 0);

  const run = useCallback(
    async (fn: () => Promise<LeagueStateResponse>) => {
      setBusy(true);
      setError(null);
      try {
        onState(await fn());
      } catch (e) {
        if (e instanceof ApiError && SESSION_GONE.has(e.code)) onSessionGone(e.code);
        else setError(e instanceof ApiError ? e.message : "That change could not be saved.");
      } finally {
        setBusy(false);
      }
    },
    [onState, onSessionGone],
  );

  const projById = (id: number) => snapshot.players[String(id)];
  const projectedPoints = (id: number) => {
    const p = snapshot.players[String(id)];
    if (!p) return null;
    const s = scoreSplit(p.projections.season, "total", snapshot.settings.scoringItems, p.positionSlotId);
    return s ? s.points : null;
  };

  return (
    <div className="space-y-4">
      <Card aria-labelledby="builder-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle id="builder-heading">Teams</SectionTitle>
          <Badge tone="info">Players &amp; projections from ESPN</Badge>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {league.teams.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTeamId(t.id)}
              className={cx(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                t.id === activeTeam?.id ? "border-navy bg-navy text-navy-fg" : "border-line hover:bg-muted",
              )}
            >
              {t.name} <span className={cx("ml-1", t.id === activeTeam?.id ? "text-navy-soft" : "text-fg-soft")}>{t.playerIds.length}</span>
            </button>
          ))}
        </div>

        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTeam.trim()) return;
            const name = newTeam.trim();
            setNewTeam("");
            void run(() => api.editCustom({ action: "addTeam", name })).then(() => undefined);
          }}
        >
          <input
            className="rounded-xl border border-line px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            placeholder="New team name"
            value={newTeam}
            maxLength={60}
            onChange={(e) => setNewTeam(e.target.value)}
            aria-label="New team name"
          />
          <Button type="submit" disabled={busy || !newTeam.trim()}>Add team</Button>
          {busy && <Spinner label="Saving…" />}
        </form>
        {error && <div className="mt-3"><Alert tone="bad" role="alert">{error}</Alert></div>}
        {league.teams.length < 2 && (
          <p className="mt-3 text-sm text-fg-soft">Add at least two teams to analyze a trade.</p>
        )}
      </Card>

      {activeTeam && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card aria-labelledby="roster-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="roster-heading" className="flex items-center gap-2 text-base font-semibold">
                <span aria-hidden="true" className="h-5 w-1 rounded-full bg-gold" />
                {activeTeam.name}
                <span className="text-sm font-normal text-fg-soft">{activeTeam.playerIds.length}/{rosterLimit}</span>
              </h3>
              <div className="flex gap-2">
                <RenameButton teamName={activeTeam.name} disabled={busy} onRename={(name) => run(() => api.editCustom({ action: "renameTeam", teamId: activeTeam.id, name }))} />
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => run(() => api.editCustom({ action: "removeTeam", teamId: activeTeam.id })).then(() => setActiveTeamId(null))}
                >
                  Remove team
                </Button>
              </div>
            </div>

            {activeTeam.playerIds.length === 0 ? (
              <p className="mt-4 text-sm text-fg-soft">No players yet. Search on the right to add some.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line/60">
                {activeTeam.playerIds.map((id) => {
                  const p = projById(id);
                  const pts = projectedPoints(id);
                  return (
                    <li key={id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{p?.name ?? `Player ${id}`}</span>{" "}
                        <span className="text-xs text-fg-soft">{p?.position}{p?.proTeamAbbrev ? ` · ${p.proTeamAbbrev}` : ""}</span>{" "}
                        <InjuryBadge status={p?.injuryStatus ?? null} />
                      </span>
                      <span className="tabular-nums text-fg-soft" title="Projected points under this league's scoring">{pts === null ? "—" : formatPoints(pts)}</span>
                      <Button variant="ghost" className="px-2 py-1" disabled={busy} aria-label={`Remove ${p?.name ?? "player"}`} onClick={() => run(() => api.editCustom({ action: "removePlayer", teamId: activeTeam.id, playerId: id }))}>
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <PlayerSearch
            disabled={busy}
            full={activeTeam.playerIds.length >= rosterLimit}
            onAdd={(playerId) => run(() => api.editCustom({ action: "addPlayer", teamId: activeTeam.id, playerId }))}
            onSessionGone={onSessionGone}
          />
        </div>
      )}
    </div>
  );
}

function RenameButton({ teamName, onRename, disabled }: { teamName: string; onRename: (name: string) => void; disabled: boolean }) {
  return (
    <Button
      disabled={disabled}
      onClick={() => {
        const name = window.prompt("Rename team", teamName)?.trim();
        if (name && name !== teamName) onRename(name);
      }}
    >
      Rename
    </Button>
  );
}

function PlayerSearch({ onAdd, onSessionGone, disabled, full }: { onAdd: (id: number) => void; onSessionGone: (code: string) => void; disabled: boolean; full: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlayerSearchResponse["players"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const search = useCallback(async (query: string) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.searchPlayers(query);
      if (id === seq.current) setResults(res.players);
    } catch (e) {
      if (e instanceof ApiError && SESSION_GONE.has(e.code)) onSessionGone(e.code);
      else if (id === seq.current) setError(e instanceof ApiError ? e.message : "Search failed.");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [onSessionGone]);

  // Debounced search; also refresh when the roster changes (added players drop out).
  useEffect(() => {
    const t = setTimeout(() => void search(q), 250);
    return () => clearTimeout(t);
  }, [q, search, disabled]);

  return (
    <Card aria-labelledby="search-heading">
      <h3 id="search-heading" className="flex items-center gap-2 text-base font-semibold">
        <span aria-hidden="true" className="h-5 w-1 rounded-full bg-gold" />
        Add players from ESPN
      </h3>
      <input
        className="mt-3 w-full rounded-xl border border-line px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
        placeholder="Search players by name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search players"
      />
      {full && <p className="mt-2 text-sm text-warn">This team is full. Remove a player before adding another.</p>}
      {error && <div className="mt-2"><Alert tone="warn" role="status">{error}</Alert></div>}
      <div className="mt-3" aria-live="polite">
        {loading && results.length === 0 ? (
          <Spinner label="Loading players…" />
        ) : results.length === 0 ? (
          <p className="text-sm text-fg-soft">No matching players.</p>
        ) : (
          <ul className="max-h-[22rem] divide-y divide-line/60 overflow-y-auto pr-1">
            {results.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span>{" "}
                  <span className="text-xs text-fg-soft">{p.position}{p.proTeam ? ` · ${p.proTeam}` : ""}</span>{" "}
                  <InjuryBadge status={p.injuryStatus} />
                </span>
                <span className="tabular-nums text-fg-soft" title="Projected points under this league's scoring">{formatPoints(p.projectedPoints)}</span>
                <Button variant="primary" className="px-3 py-1" disabled={disabled || full} aria-label={`Add ${p.name}`} onClick={() => onAdd(p.id)}>Add</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-xs text-fg-soft">Ranked by projected points under this league&apos;s scoring. Projections are from ESPN.</p>
    </Card>
  );
}
