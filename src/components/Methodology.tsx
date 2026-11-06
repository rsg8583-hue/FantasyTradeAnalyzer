import type { TradeAnalysis } from "@/lib/engine/types";

export function Methodology({ analysis }: { analysis: TradeAnalysis }) {
  return (
    <details className="rounded-xl border border-line bg-surface p-4 text-sm shadow-sm">
      <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-accent">Methodology</summary>
      <div className="mt-3 space-y-3 text-fg-soft">
        <p>
          <strong className="text-fg">Metric.</strong> Projected starting-lineup improvement (%) = 100 × (projected lineup points after − before) ÷ before,
          calculated separately for each team. The two percentages are independent and need not sum to anything.
        </p>
        <p>
          <strong className="text-fg">Window.</strong> {analysis.horizon.label}. {analysis.horizon.note} Both &quot;before&quot; and &quot;after&quot; use the same window.
        </p>
        <p>
          <strong className="text-fg">Projections.</strong> {analysis.projectionSource}, fetched {new Date(analysis.projectionFetchedAt).toLocaleString()}.
          {analysis.sport === "football"
            ? " Football uses each player's weekly projection for the window, scored with this league's rules. A player whose pro team has no game that week counts as 0; a player with no projection is treated as missing, never as 0."
            : " Basketball uses each player's per-game season projection, scored with this league's rules and multiplied by that player's scheduled games on each remaining day."}
        </p>
        <p>
          <strong className="text-fg">Lineups.</strong> For each scoring period in the window, the best legal starting lineup is found with an exact assignment
          algorithm (Hungarian method) over the league&apos;s actual lineup slots and each player&apos;s ESPN slot eligibility. Each player fills at most one slot,
          so flex/utility slots never double-count. Bench and IR players do not score.
        </p>
        <p>
          <strong className="text-fg">Roster changes.</strong> Received players take active roster spots. If a team exceeds its active limit, you choose the drops.
          Open spots are empty unless you pick a free-agent replacement.
        </p>
        <p>
          <strong className="text-fg">Missing data.</strong> If a traded, dropped, or added player has no projection, or the baseline is zero, that team&apos;s percentage is
          &quot;not available&quot; and the verdict is &quot;insufficient data&quot;. A team &quot;improves&quot; when its percentage, rounded to one decimal, is above 0.0%.
        </p>
        <p>
          <strong className="text-fg">AI.</strong> The AI model receives only league rules, the involved players&apos; projections, and the computed results, with teams labeled
          &quot;Team A&quot; and &quot;Team B&quot;. It never receives ESPN credentials. It cannot change any number.
        </p>
      </div>
    </details>
  );
}
