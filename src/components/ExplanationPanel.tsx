import type { ExplanationResult } from "@/lib/ai/schema";
import type { TradeAnalysis } from "@/lib/engine/types";
import { Alert, Badge, Card, SectionTitle, Spinner } from "./ui";

type State = { status: "idle" | "loading" } | { status: "done"; result: ExplanationResult } | { status: "error"; message: string };

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg-soft">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

export function ExplanationPanel({ analysis, state }: { analysis: TradeAnalysis; state: State }) {
  const teamName = (label: string) => analysis.teams.find((t) => `Team ${t.side}` === label)?.teamName;
  return (
    <Card aria-labelledby="explain-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle as="h3" id="explain-heading">Explanation</SectionTitle>
        {state.status === "done" && (
          state.result.source === "ai"
            ? <Badge tone="info">AI-written · {state.result.model} · checked against the calculation</Badge>
            : <Badge>Standard explanation (no AI)</Badge>
        )}
      </div>

      <div className="mt-3 space-y-4" aria-live="polite">
        {state.status === "loading" && <Spinner label="Writing an explanation of the calculated results…" />}
        {state.status === "error" && (
          <Alert tone="warn" title="Explanation unavailable">{state.message} The calculated results above are unaffected.</Alert>
        )}
        {state.status === "done" && (
          <>
            {state.result.fallbackReason && (
              <Alert tone={state.result.configError ? "bad" : "warn"} title={state.result.configError ? "AI not configured" : "AI explanation not used"}>
                {state.result.fallbackReason}
              </Alert>
            )}
            <p className="text-sm">{state.result.explanation.summary}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {state.result.explanation.teams.map((t) => (
                <div key={t.team} className={`space-y-2 rounded-xl border border-line border-t-4 p-4 ${t.team === "Team A" ? "border-t-accent" : "border-t-gold"}`}>
                  <p className="font-medium">{t.team}{teamName(t.team) ? `: ${teamName(t.team)}` : ""}</p>
                  <p className="text-sm text-fg-soft">{t.explanation}</p>
                  <List title="Positional improvements" items={t.positionalImprovements} />
                  <List title="Positional weaknesses" items={t.positionalWeaknesses} />
                  <List title="Depth and roster implications" items={t.depthAndRosterImplications} />
                </div>
              ))}
            </div>
            <List title="Risks" items={state.result.explanation.risks} />
            <List title="Assumptions" items={state.result.explanation.assumptions} />
            <List title="Limitations" items={state.result.explanation.limitations} />
            {state.result.source === "ai" && (
              <p className="text-xs text-fg-soft">
                The AI only explains numbers that were already calculated. Its response is rejected if it changes the verdict or cites a percentage that differs from the calculation.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
