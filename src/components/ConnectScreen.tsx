"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { Sport } from "@/lib/domain/types";
import { defaultPresetId, presetsForSport } from "@/lib/league/presets";
import { Alert, Button, Card, SectionTitle, Spinner, TopBar, cx } from "./ui";

function defaultSeason(sport: Sport, now = new Date()): number {
  // ESPN basketball seasons are labeled by the year they end (2026–27 → 2027).
  const y = now.getFullYear();
  return sport === "basketball" && now.getMonth() >= 8 ? y + 1 : y;
}

function readNotice(): string | null {
  if (typeof window === "undefined") return null;
  const reason = new URLSearchParams(window.location.search).get("reason");
  if (reason === "expired") return "Your session expired. Create a league again to continue.";
  if (reason === "disconnected") return "Your league was closed.";
  return null;
}

const inputClass =
  "w-full rounded-xl border border-line px-3 py-2.5 text-sm focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/**
 * Keyed on bfcacheId so a push/replace (e.g. after closing a league) starts
 * fresh instead of restoring the Activity-preserved instance.
 */
export function ConnectScreen() {
  const { bfcacheId } = useRouter();
  return <LandingGate key={bfcacheId} />;
}

function LandingGate() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api
      .session()
      .then(() => router.replace("/dashboard"))
      .catch(() => setChecking(false));
  }, [router]);

  return (
    <>
      <TopBar />
      {checking ? (
        <main className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center p-6">
          <Spinner label="Checking for an existing league…" />
        </main>
      ) : (
        <LandingPanel />
      )}
    </>
  );
}

const STEPS = [
  { n: "1", title: "Build your teams", text: "Create as many teams as you like and fill them from ESPN's real player pool." },
  { n: "2", title: "Live ESPN projections", text: "Every player carries ESPN's current season projection, scored by your chosen rules." },
  { n: "3", title: "Compare any trade", text: "Pick two of your teams, swap players, and see each side's projected-points change." },
];

function LandingPanel() {
  const router = useRouter();
  const [name, setName] = useState("My League");
  const [sport, setSport] = useState<Sport>("football");
  const [season, setSeason] = useState(() => defaultSeason("football"));
  const [presetId, setPresetId] = useState(() => defaultPresetId("football"));
  const [busy, setBusy] = useState<null | "create" | "demo">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice] = useState(readNotice);

  const years = Array.from({ length: defaultSeason("basketball") - 2018 + 1 }, (_, i) => defaultSeason("basketball") - i);
  const presets = presetsForSport(sport);

  function pickSport(s: Sport) {
    setSport(s);
    setSeason(defaultSeason(s));
    setPresetId(defaultPresetId(s));
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("create");
    try {
      await api.createCustom({ name, sport, season, presetId });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the league.");
      setBusy(null);
    }
  }

  async function startDemo(s: Sport) {
    setError(null);
    setBusy("demo");
    try {
      await api.demo(s);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start demo.");
      setBusy(null);
    }
  }

  return (
    <main className="flex-1">
      <section className="hero-band">
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:pt-14">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gold">
            Football · Basketball · Live ESPN projections
          </p>
          <h1 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
            Build teams. Compare trades. <span className="text-gold">No league login.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base text-navy-soft sm:text-lg">
            Create your own teams from ESPN&apos;s real player pool, then see how any trade changes each team&apos;s projected points.
            No ESPN account, league link, or cookies needed.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="cta" onClick={() => document.getElementById("build-heading")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
              Build a league
            </Button>
            <Button variant="onNavy" onClick={() => startDemo("football")} disabled={busy !== null}>Try a demo</Button>
          </div>
        </div>
      </section>

      <div className="mx-auto -mt-16 w-full max-w-5xl space-y-6 px-4 pb-12">
        {notice && <Alert tone="info" role="status">{notice}</Alert>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <Card aria-labelledby="build-heading" className="p-5 sm:p-7">
            <SectionTitle id="build-heading">Build a league</SectionTitle>
            <form onSubmit={onCreate} className="mt-5 space-y-5" noValidate>
              <div>
                <label htmlFor="name" className="mb-1.5 block text-sm font-medium">League name</label>
                <input id="name" required maxLength={60} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset>
                  <legend className="mb-1.5 block text-sm font-medium">Sport</legend>
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
                    {(["football", "basketball"] as const).map((s) => (
                      <label
                        key={s}
                        className={cx(
                          "cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                          sport === s ? "bg-navy text-navy-fg shadow-sm" : "text-fg-soft hover:text-fg",
                        )}
                      >
                        <input type="radio" name="sport" value={s} className="sr-only" checked={sport === s} onChange={() => pickSport(s)} />
                        {s === "football" ? "Football" : "Basketball"}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label htmlFor="season" className="mb-1.5 block text-sm font-medium">Season</label>
                  <select id="season" className={inputClass} value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-describedby="season-hint">
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <p id="season-hint" className="mt-1 text-xs text-fg-soft">Basketball uses the ending year.</p>
                </div>
              </div>

              <div>
                <label htmlFor="preset" className="mb-1.5 block text-sm font-medium">Scoring</label>
                <select id="preset" className={inputClass} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-fg-soft">{presets.find((p) => p.id === presetId)?.description}</p>
              </div>

              {error && <Alert tone="bad" role="alert" title="Could not create the league">{error}</Alert>}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" className="px-6 py-2.5" disabled={busy !== null}>
                  {busy === "create" ? "Loading ESPN projections…" : "Create league"}
                </Button>
                {busy === "create" && <Spinner label="Fetching the ESPN player pool…" />}
              </div>
            </form>
          </Card>

          <aside className="space-y-4">
            {STEPS.map((s) => (
              <Card key={s.n} as="div" className="flex gap-3">
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy text-base font-bold text-gold">{s.n}</span>
                <div>
                  <p className="font-semibold">{s.title}</p>
                  <p className="mt-0.5 text-sm text-fg-soft">{s.text}</p>
                </div>
              </Card>
            ))}
            <Card as="div" className="border-demo/30">
              <p className="font-semibold">Just exploring?</p>
              <p className="mt-1 text-sm text-fg-soft">The demos use a <strong>fictional</strong> league with made-up players and projections.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => startDemo("football")} disabled={busy !== null}>Demo: football</Button>
                <Button onClick={() => startDemo("basketball")} disabled={busy !== null}>Demo: basketball</Button>
              </div>
            </Card>
          </aside>
        </div>

        <p className="text-center text-xs text-fg-soft">
          Player projections come from ESPN&apos;s unofficial, undocumented public API, which may change without notice. Not affiliated with or endorsed by ESPN.
          Results are projection-based estimates, not win probabilities or fairness judgments.
        </p>
      </div>
    </main>
  );
}
