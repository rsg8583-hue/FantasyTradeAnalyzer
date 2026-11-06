"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ExplanationResult } from "@/lib/ai/schema";
import { api, ApiError, SESSION_GONE } from "@/lib/client/api";
import { emptyDraft, reconcileDraft, toRequest, type TradeDraft } from "@/lib/client/draft";
import { usePolling } from "@/lib/client/usePolling";
import type { LeagueStateResponse } from "@/lib/domain/apiTypes";
import type { TradeAnalysis } from "@/lib/engine/types";
import { projectionProviderFor } from "@/lib/projections/select";
import { LeagueBuilder } from "./LeagueBuilder";
import { LeagueHeader } from "./LeagueHeader";
import { RosterView } from "./RosterView";
import { TradeBuilder } from "./TradeBuilder";
import { TradeResults } from "./TradeResults";
import { Alert, Button, Card, Spinner, TopBar, cx } from "./ui";

const POLL_KEY = "fta.pollMs";
const DEFAULT_POLL_MS = 5 * 60_000;

type ExplainState = { status: "idle" | "loading" } | { status: "done"; result: ExplanationResult } | { status: "error"; message: string };
type Tab = "build" | "trade" | "rosters";
const TAB_LABEL: Record<Tab, string> = { build: "Build league", trade: "Trade builder", rosters: "Teams & rosters" };

function readPollPref(): number {
  try {
    const v = Number(window.localStorage.getItem(POLL_KEY));
    return Number.isFinite(v) && window.localStorage.getItem(POLL_KEY) !== null ? v : DEFAULT_POLL_MS;
  } catch {
    return DEFAULT_POLL_MS;
  }
}

/**
 * Keyed on bfcacheId so connecting to a league (a push/replace) never shows a
 * previously-preserved dashboard. On back/forward the preserved instance is
 * shown, and its load effect re-checks the session.
 */
export function Dashboard() {
  const { bfcacheId } = useRouter();
  return <DashboardView key={bfcacheId} />;
}

function DashboardView() {
  const router = useRouter();
  const [state, setState] = useState<LeagueStateResponse | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  // Read lazily: the dashboard renders a spinner first, so this never affects hydration.
  const [pollMs, setPollMs] = useState(readPollPref);
  const [tab, setTab] = useState<Tab>("trade");
  const [draft, setDraft] = useState<TradeDraft>(emptyDraft);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<TradeAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<ExplainState>({ status: "idle" });
  const draftRef = useRef(draft);
  const lastFetchedAt = useRef<string | null>(null);
  const explainSeq = useRef(0);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && SESSION_GONE.has(e.code)) {
        router.replace(e.code === "SESSION_EXPIRED" ? "/?reason=expired" : "/");
        return true;
      }
      return false;
    },
    [router],
  );

  const applyState = useCallback((next: LeagueStateResponse) => {
    // A new snapshot may have moved players: drop selections that are no longer valid.
    if (next.snapshot && next.snapshot.fetchedAt !== lastFetchedAt.current) {
      lastFetchedAt.current = next.snapshot.fetchedAt;
      const { draft: fixed, notes } = reconcileDraft(draftRef.current, next.snapshot);
      draftRef.current = fixed;
      setDraft(fixed);
      setDraftNotes(notes);
    }
    setState(next);
    setClientError(null);
  }, []);

  // Initial load: read session state, then sync if no snapshot is cached.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.session();
        if (cancelled) return;
        applyState(s.snapshot ? s : await api.poll());
        // A brand-new custom league opens on the builder.
        if (s.mode === "custom" && (s.customLeague?.teams.length ?? 0) < 2) setTab("build");
      } catch (e) {
        if (!cancelled && !handleError(e)) setFatal(e instanceof ApiError ? e.message : "Could not load the league.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyState, handleError]);

  const sync = useCallback(
    async (manual: boolean) => {
      if (manual) setRefreshing(true);
      try {
        applyState(manual ? await api.refresh() : await api.poll());
      } catch (e) {
        if (!handleError(e)) setClientError(e instanceof ApiError ? e.message : "Refresh failed.");
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [applyState, handleError],
  );

  usePolling(state ? pollMs : 0, () => void sync(false));

  const snapshot = state?.snapshot ?? null;
  const projections = useMemo(
    () => (snapshot ? projectionProviderFor(snapshot).project(snapshot, Object.keys(snapshot.players).map(Number)) : null),
    [snapshot],
  );

  function updateDraft(next: TradeDraft) {
    if (!snapshot) return;
    setDraft(reconcileDraft(next, snapshot).draft);
    setDraftNotes([]);
    setAnalysis(null);
    setAnalyzeError(null);
    setExplanation({ status: "idle" });
  }

  async function analyze() {
    if (!snapshot) return;
    const req = toRequest(draft, snapshot);
    if (!req) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setExplanation({ status: "idle" });
    try {
      const result = await api.analyze(req);
      setAnalysis(result);
      const seq = ++explainSeq.current;
      setExplanation({ status: "loading" });
      api
        .explain(req)
        .then((r) => seq === explainSeq.current && setExplanation({ status: "done", result: r }))
        .catch((e) => {
          if (seq === explainSeq.current && !handleError(e)) {
            setExplanation({ status: "error", message: e instanceof ApiError ? e.message : "Explanation request failed." });
          }
        });
    } catch (e) {
      if (handleError(e)) return;
      setAnalysis(null);
      setAnalyzeError(e instanceof ApiError ? e.message : "Analysis failed.");
      if (e instanceof ApiError && e.code === "CONFLICT") void sync(false);
    } finally {
      setAnalyzing(false);
    }
  }

  async function disconnect() {
    try {
      await api.disconnect();
    } finally {
      router.replace("/?reason=disconnected");
    }
  }

  function changePoll(ms: number) {
    setPollMs(ms);
    try {
      window.localStorage.setItem(POLL_KEY, String(ms));
    } catch {
      // Preference only; ignore storage failures.
    }
  }

  const tabs: Tab[] = state?.mode === "custom" ? ["build", "trade", "rosters"] : ["trade", "rosters"];
  const activeTab: Tab = tabs.includes(tab) ? tab : tabs[0];

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(tabs.indexOf(activeTab) + dir + tabs.length) % tabs.length];
      setTab(next);
      document.getElementById(`tab-${next}`)?.focus();
    }
  }

  if (fatal) {
    return (
      <>
      <TopBar />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <Alert tone="bad" role="alert" title="Could not load your league" action={<Button onClick={() => router.replace("/")}>Back to connect</Button>}>
          {fatal}
        </Alert>
      </main>
      </>
    );
  }

  if (!state) {
    return (
      <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center p-6">
        <Spinner label="Loading league…" />
      </main>
      </>
    );
  }

  return (
    <>
    <TopBar>
      <span className="hidden truncate text-sm text-navy-soft sm:block">{state.snapshot?.settings.name}</span>
    </TopBar>
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6">
      <LeagueHeader
        state={state}
        refreshing={refreshing}
        pollMs={pollMs}
        onPollMsChange={changePoll}
        onRefresh={() => void sync(true)}
        onDisconnect={() => void disconnect()}
        onReconnect={() => void disconnect()}
        clientError={clientError}
      />

      {!snapshot ? (
        <Card>
          <p className="text-sm">No league data has loaded yet.</p>
          {state.sync.lastError && <p className="mt-1 text-sm text-fg-soft">{state.sync.lastError.message}</p>}
          <Button className="mt-3" onClick={() => void sync(true)}>Try again</Button>
        </Card>
      ) : (
        <>
          {!snapshot.format.supported && (
            <Alert tone="bad" role="alert" title="This league format is not supported for trade analysis">
              <ul className="list-disc pl-5">{snapshot.format.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="mt-1">Rosters are shown for reference, but no percentages are calculated, rather than applying a points model that doesn&apos;t fit this league.</p>
            </Alert>
          )}
          {projections?.status === "unavailable" && snapshot.format.supported && (
            <Alert tone="warn" role="status" title="Projections unavailable">{projections.reason}</Alert>
          )}
          {draftNotes.length > 0 && (
            <Alert tone="warn" role="status" title="Trade selections updated after refresh">
              <ul className="list-disc pl-5">{draftNotes.map((n) => <li key={n}>{n}</li>)}</ul>
            </Alert>
          )}

          <div role="tablist" aria-label="Dashboard sections" className="inline-flex gap-1 rounded-full border border-line bg-surface p-1 shadow-sm">
            {tabs.map((t) => (
              <button
                key={t}
                id={`tab-${t}`}
                role="tab"
                type="button"
                aria-selected={activeTab === t}
                aria-controls={`panel-${t}`}
                tabIndex={activeTab === t ? 0 : -1}
                onClick={() => setTab(t)}
                onKeyDown={onTabKey}
                className={cx(
                  "rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                  activeTab === t ? "bg-navy text-navy-fg shadow-[inset_0_-3px_0_var(--gold)]" : "text-fg-soft hover:bg-muted hover:text-fg",
                )}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>

          {state.mode === "custom" && state.customLeague && (
            <div id="panel-build" role="tabpanel" aria-labelledby="tab-build" hidden={activeTab !== "build"}>
              <LeagueBuilder
                league={state.customLeague}
                snapshot={snapshot}
                onState={applyState}
                onSessionGone={(code) => router.replace(code === "SESSION_EXPIRED" ? "/?reason=expired" : "/")}
              />
            </div>
          )}

          <div id="panel-trade" role="tabpanel" aria-labelledby="tab-trade" hidden={activeTab !== "trade"} className="space-y-5">
            {projections && (
              <TradeBuilder snapshot={snapshot} projections={projections} draft={draft} onChange={updateDraft} onAnalyze={() => void analyze()} analyzing={analyzing} />
            )}
            {analyzeError && <Alert tone="bad" role="alert" title="Could not analyze this trade">{analyzeError}</Alert>}
            {analysis ? (
              <TradeResults
                analysis={analysis}
                outdated={analysis.snapshotFetchedAt !== snapshot.fetchedAt}
                onReanalyze={() => void analyze()}
                explanation={explanation}
              />
            ) : (
              !analyzing && (
                <p className="rounded-2xl border-2 border-dashed border-line bg-surface/60 p-8 text-center text-sm text-fg-soft">
                  Select two teams and the players each sends, then choose <strong>Analyze trade</strong> to compare projected starting lineups.
                </p>
              )
            )}
          </div>
          <div id="panel-rosters" role="tabpanel" aria-labelledby="tab-rosters" hidden={activeTab !== "rosters"}>
            {projections && <RosterView snapshot={snapshot} projections={projections} />}
          </div>
        </>
      )}

      <footer className="pt-4 text-xs text-fg-soft">
        Unofficial ESPN integration: ESPN&apos;s fantasy API is undocumented and may change without notice. Not affiliated with ESPN. This app only reads data;
        it never proposes, accepts, or submits trades.
      </footer>
    </main>
    </>
  );
}
