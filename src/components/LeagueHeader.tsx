"use client";

import { useEffect, useState } from "react";
import type { LeagueStateResponse } from "@/lib/domain/apiTypes";
import { absoluteTime, relativeTime } from "@/lib/client/format";
import { Alert, Button, cx } from "./ui";

export const POLL_OPTIONS = [
  { label: "Off", ms: 0 },
  { label: "Every 1 min", ms: 60_000 },
  { label: "Every 2 min", ms: 120_000 },
  { label: "Every 5 min", ms: 300_000 },
  { label: "Every 10 min", ms: 600_000 },
  { label: "Every 30 min", ms: 1_800_000 },
];

interface Props {
  state: LeagueStateResponse;
  refreshing: boolean;
  pollMs: number;
  onPollMsChange: (ms: number) => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  clientError: string | null;
}

export function LeagueHeader({ state, refreshing, pollMs, onPollMsChange, onRefresh, onDisconnect, onReconnect, clientError }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const s = state.snapshot?.settings;
  const sync = state.sync;
  const isDemo = state.mode === "demo";
  const isCustom = state.mode === "custom";
  const kicker = isDemo ? "Demo league" : isCustom ? "Custom league · live ESPN projections" : "ESPN league · unofficial API";
  const closeLabel = isDemo ? "Exit demo" : isCustom ? "Close league" : "Disconnect";
  const status = refreshing
    ? { dot: "bg-accent animate-pulse", text: "Syncing…" }
    : sync.stale
      ? { dot: "bg-warn", text: "Stale data" }
      : { dot: "bg-good", text: "Synced" };

  const facts = s
    ? [
        s.sport === "football" ? "Football" : "Basketball",
        `${s.season} season`,
        s.scoringLabel,
        `${s.teamCount || state.snapshot?.teams.length} teams`,
        ...(s.keeperCount === 0 ? ["Redraft"] : []),
      ]
    : [];

  return (
    <div className="space-y-3">
      {isDemo && (
        <div role="note" className="rounded-xl border-2 border-demo/50 bg-demo/10 px-4 py-2 text-sm font-medium">
          <span aria-hidden="true">◆ </span>DEMO MODE: every team, player, schedule, and projection on this page is fictional.
        </div>
      )}

      <div className="hero-band overflow-hidden rounded-2xl shadow-lg">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-gold">{kicker}</p>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">{s?.name ?? "League"}</h1>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {facts.length > 0 ? (
                facts.map((f) => (
                  <li key={f} className="rounded-full bg-white/10 px-2.5 py-1 text-navy-fg">{f}</li>
                ))
              ) : (
                <li className="text-navy-soft">League details unavailable</li>
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 font-medium">
                <span aria-hidden="true" className={cx("size-2 rounded-full", status.dot)} />
                {status.text}
              </span>
              <span className="text-navy-soft">
                Last successful sync:{" "}
                <time className="text-navy-fg" dateTime={sync.lastSuccessAt ?? undefined} title={absoluteTime(sync.lastSuccessAt)}>
                  {relativeTime(sync.lastSuccessAt, now)}
                </time>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="cta" onClick={onRefresh} disabled={refreshing} aria-label="Refresh league data now">
                <span aria-hidden="true">↻</span> Refresh league
              </Button>
              <label className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-3 pr-1 text-sm text-navy-soft">
                <span>Auto-refresh</span>
                <select
                  className="rounded-full border-0 bg-white/90 px-2 py-1 text-sm text-[#0d1b2e]"
                  value={pollMs}
                  onChange={(e) => onPollMsChange(Number(e.target.value))}
                >
                  {POLL_OPTIONS.map((o) => (
                    <option key={o.ms} value={o.ms}>{o.label}</option>
                  ))}
                </select>
              </label>
              <Button variant="onNavy" onClick={onDisconnect}>
                {closeLabel}
              </Button>
            </div>
            <p className="text-xs text-navy-soft">
              {pollMs > 0 ? "Periodic refresh (not live), paused while this tab is hidden." : "Automatic refresh is off."}
            </p>
          </div>
        </div>
      </div>

      {sync.credentialsRejected && (
        <Alert
          tone="bad"
          role="alert"
          title="ESPN rejected your credentials"
          action={<Button variant="primary" onClick={onReconnect}>Reconnect with new cookies</Button>}
        >
          {sync.lastError?.message} Showing the last successful data, labeled stale.
        </Alert>
      )}
      {!sync.credentialsRejected && sync.lastError && (
        <Alert tone="warn" role="status" title="Latest refresh failed">
          {sync.lastError.message} Showing the last successful data from {absoluteTime(sync.lastSuccessAt)}, labeled stale.
        </Alert>
      )}
      {!sync.lastError && sync.stale && (
        <Alert tone="warn" role="status" title="Data may be out of date">
          The last successful sync was more than 15 minutes ago. Refresh to update rosters and projections.
        </Alert>
      )}
      {clientError && <Alert tone="warn" role="status">{clientError}</Alert>}
    </div>
  );
}
