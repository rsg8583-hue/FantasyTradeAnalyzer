import type { Player } from "@/lib/domain/types";
import type { PlayerHorizonProjection } from "@/lib/projections/types";
import { formatPoints } from "@/lib/client/format";
import { Badge } from "./ui";

export function ProjectionCell({ proj, sport }: { proj: PlayerHorizonProjection | undefined; sport: "football" | "basketball" }) {
  if (!proj) return <span className="text-fg-soft">Unavailable</span>;
  if (proj.total === null) {
    return (
      <span className="text-warn" title={proj.missingReason ?? undefined}>
        <span aria-hidden="true">⚠ </span>No projection
      </span>
    );
  }
  return (
    <span className="tabular-nums" title={proj.basis}>
      {formatPoints(proj.total)}
      {sport === "basketball" && proj.gamesScheduled !== null && <span className="text-fg-soft"> · {proj.gamesScheduled} g</span>}
      {sport === "football" && proj.gamesScheduled === 0 && <span className="text-fg-soft"> · bye</span>}
    </span>
  );
}

export function InjuryBadge({ status }: { status: string | null }) {
  if (!status || status === "ACTIVE") return null;
  const label = status.replaceAll("_", " ").toLowerCase();
  return <Badge tone="warn">{label}</Badge>;
}

export function PlayerLabel({ player }: { player: Player | undefined }) {
  if (!player) return <span className="text-fg-soft">Unknown player</span>;
  return (
    <span className="min-w-0">
      <span className="font-medium">{player.name}</span>{" "}
      <span className="text-xs text-fg-soft">
        {player.position}
        {player.proTeamAbbrev ? ` · ${player.proTeamAbbrev}` : ""}
      </span>
    </span>
  );
}
