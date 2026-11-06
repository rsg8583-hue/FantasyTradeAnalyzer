"use client";

import { useState } from "react";
import type { LeagueSnapshot } from "@/lib/domain/types";
import type { ProjectionSet } from "@/lib/projections/types";
import { InjuryBadge, PlayerLabel, ProjectionCell } from "./PlayerBits";
import { Alert, Badge, Card, SectionTitle } from "./ui";

export function RosterView({ snapshot, projections }: { snapshot: LeagueSnapshot; projections: ProjectionSet }) {
  const [teamId, setTeamId] = useState<number>(snapshot.teams[0]?.id ?? 0);
  const team = snapshot.teams.find((t) => t.id === teamId) ?? snapshot.teams[0];
  const slotName = (id: number | null) => (id === null ? "—" : snapshot.settings.slots.find((s) => s.slotId === id)?.name ?? `Slot ${id}`);
  const byPlayer = projections.status === "available" ? projections.byPlayer : {};

  return (
    <div className="space-y-4">
      <Card aria-labelledby="settings-heading">
        <SectionTitle id="settings-heading">League settings</SectionTitle>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-soft">Starting lineup</dt>
            <dd>{snapshot.settings.slots.filter((s) => s.kind === "starter").map((s) => `${s.count}× ${s.name}`).join(", ") || "Unavailable"}</dd>
          </div>
          <div>
            <dt className="text-fg-soft">Bench / IR</dt>
            <dd>
              {snapshot.settings.slots.filter((s) => s.kind === "bench").reduce((a, s) => a + s.count, 0)} bench · {snapshot.settings.irSlotCount} IR · active limit{" "}
              {snapshot.settings.activeRosterLimit}
            </dd>
          </div>
          <div>
            <dt className="text-fg-soft">Scoring rules imported</dt>
            <dd>{snapshot.settings.scoringItems.length > 0 ? `${snapshot.settings.scoringItems.length} stat rules` : "None returned"}</dd>
          </div>
          <div>
            <dt className="text-fg-soft">Projection window</dt>
            <dd>{projections.status === "available" ? projections.horizon.label : <span className="text-warn">Unavailable: {projections.reason}</span>}</dd>
          </div>
          <div>
            <dt className="text-fg-soft">Free-agent pool</dt>
            <dd>
              {snapshot.freeAgents.status === "available"
                ? snapshot.freeAgents.value.length === 0
                  ? "Loaded: no free agents returned (empty)"
                  : `Loaded: top ${snapshot.freeAgents.value.length} by ownership`
                : <span className="text-warn">Unavailable: {snapshot.freeAgents.reason}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-fg-soft">Pro schedule</dt>
            <dd>{snapshot.proSchedule.status === "available" ? "Loaded" : <span className="text-warn">Unavailable: {snapshot.proSchedule.reason}</span>}</dd>
          </div>
        </dl>
        {snapshot.warnings.length > 0 && (
          <div className="mt-3">
            <Alert tone="warn" title="Import warnings">
              <ul className="list-disc pl-5">{snapshot.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Alert>
          </div>
        )}
      </Card>

      <Card aria-labelledby="roster-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle id="roster-heading">Team rosters</SectionTitle>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-fg-soft">Team</span>
            <select className="rounded-full border border-line px-3 py-1.5 font-medium" value={team?.id} onChange={(e) => setTeamId(Number(e.target.value))}>
              {snapshot.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        {!team || team.roster.length === 0 ? (
          <p className="mt-4 text-sm text-fg-soft">No roster was returned for this team.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">Roster for {team.name}</caption>
              <thead>
                <tr className="border-b border-line bg-muted text-left text-xs uppercase tracking-wide text-fg-soft">
                  <th scope="col" className="py-2 pr-3 font-medium">Player</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Current slot</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Status (as reported)</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Projected pts (window)</th>
                </tr>
              </thead>
              <tbody>
                {team.roster.map((r) => {
                  const p = snapshot.players[String(r.playerId)];
                  return (
                    <tr key={r.playerId} className="border-b border-line/60">
                      <td className="py-2 pr-3"><PlayerLabel player={p} /></td>
                      <td className="py-2 pr-3">{slotName(r.lineupSlotId) === "IR" ? <Badge tone="neutral">IR</Badge> : slotName(r.lineupSlotId)}</td>
                      <td className="py-2 pr-3">{p?.injuryStatus && p.injuryStatus !== "ACTIVE" ? <InjuryBadge status={p.injuryStatus} /> : <span className="text-fg-soft">{p?.injuryStatus ? "Active" : "Not reported"}</span>}</td>
                      <td className="py-2 pr-3 text-right"><ProjectionCell proj={byPlayer[String(r.playerId)]} sport={snapshot.settings.sport} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
