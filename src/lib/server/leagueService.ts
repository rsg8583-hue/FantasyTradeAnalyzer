import "server-only";
import { AppError, isAppError } from "@/lib/domain/errors";
import type { LeagueProvider } from "@/lib/domain/provider";
import type { LeagueSnapshot } from "@/lib/domain/types";
import { DemoLeagueProvider } from "@/lib/demo/provider";
import { EspnLeagueProvider } from "@/lib/espn/provider";
import { CustomLeagueProvider } from "@/lib/custom/provider";
import type { SessionData } from "@/lib/session/store";
import { allowRate } from "./http";

/** Automatic (polling) syncs reuse a snapshot younger than this. */
export const AUTO_SYNC_MIN_AGE_MS = 60_000;
/** Manual refreshes within this window are served from cache. */
export const MANUAL_REFRESH_COOLDOWN_MS = 15_000;
/** Hard cap on upstream syncs per session. */
const SYNC_LIMIT = { max: 20, windowMs: 10 * 60_000 };
/** A snapshot older than this is labeled stale even without an error. */
export const STALE_AFTER_MS = 15 * 60_000;

export function providerFor(session: SessionData, opts: { force?: boolean } = {}): LeagueProvider {
  if (session.mode === "demo") return new DemoLeagueProvider();
  if (session.mode === "custom") {
    if (!session.customLeague) throw new AppError("CONFLICT", "No custom league has been created yet.");
    return new CustomLeagueProvider(session.customLeague, { force: opts.force });
  }
  return new EspnLeagueProvider(session.credentials);
}

export interface SyncOutcome {
  snapshot: LeagueSnapshot | null;
  /** Error from this attempt, if any (the previous snapshot is kept). */
  error: AppError | null;
  servedFromCache: boolean;
}

/**
 * Syncs the session's league. Concurrent callers share one in-flight request;
 * recent snapshots are reused; failures keep the last good snapshot.
 */
export async function syncLeague(
  session: SessionData,
  opts: { force: boolean; now?: () => number; provider?: LeagueProvider },
): Promise<SyncOutcome> {
  const now = opts.now ?? Date.now;
  const age = session.sync.lastSuccessAt ? now() - Date.parse(session.sync.lastSuccessAt) : Infinity;
  const minAge = opts.force ? MANUAL_REFRESH_COOLDOWN_MS : AUTO_SYNC_MIN_AGE_MS;

  if (session.inflight) return settle(session, session.inflight, true);
  if (session.snapshot && age < minAge) return { snapshot: session.snapshot, error: null, servedFromCache: true };
  if (!allowRate(session, "sync", SYNC_LIMIT.max, SYNC_LIMIT.windowMs, now())) {
    return {
      snapshot: session.snapshot,
      error: new AppError("RATE_LIMITED", "Too many refreshes. Showing the last successful data; try again in a few minutes."),
      servedFromCache: true,
    };
  }

  // A forced (manual) refresh re-fetches the ESPN player pool for custom leagues.
  const provider = opts.provider ?? providerFor(session, { force: opts.force });
  session.sync.lastAttemptAt = new Date(now()).toISOString();
  const run = provider.fetchSnapshot(session.locator);
  session.inflight = run;
  try {
    return await settle(session, run, false);
  } finally {
    if (session.inflight === run) session.inflight = null;
  }
}

async function settle(session: SessionData, run: Promise<LeagueSnapshot>, shared: boolean): Promise<SyncOutcome> {
  try {
    const snapshot = await run;
    if (!shared) {
      session.snapshot = snapshot;
      session.sync.lastSuccessAt = snapshot.fetchedAt;
      session.sync.lastError = null;
      session.explanations.clear();
    }
    return { snapshot, error: null, servedFromCache: shared };
  } catch (e) {
    const err = isAppError(e) ? e : new AppError("UPSTREAM_UNAVAILABLE", "League sync failed.");
    if (!shared) session.sync.lastError = { code: err.code, message: err.message };
    return { snapshot: session.snapshot, error: err, servedFromCache: true };
  }
}

export function syncStatus(session: SessionData, now = Date.now()) {
  const { lastSuccessAt, lastAttemptAt, lastError } = session.sync;
  const age = lastSuccessAt ? now - Date.parse(lastSuccessAt) : null;
  return {
    lastSuccessAt,
    lastAttemptAt,
    lastError,
    stale: session.snapshot !== null && (lastError !== null || (age !== null && age > STALE_AFTER_MS)),
    credentialsRejected: lastError?.code === "AUTH_INVALID" || lastError?.code === "AUTH_REQUIRED",
  };
}

export type SyncStatus = ReturnType<typeof syncStatus>;
