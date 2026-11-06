import type { LeagueSnapshot } from "@/lib/domain/types";
import { FullSeasonProjectionProvider } from "./fullSeasonProvider";
import { SnapshotProjectionProvider } from "./snapshotProvider";
import type { ProjectionProvider } from "./types";

/**
 * Chooses the projection model for a snapshot. Custom (user-built) leagues use
 * full-season ESPN projections; ESPN-linked and demo leagues use the
 * weekly/daily window from the league calendar.
 */
export function projectionProviderFor(snapshot: LeagueSnapshot): ProjectionProvider {
  return snapshot.source === "custom" ? new FullSeasonProjectionProvider() : new SnapshotProjectionProvider();
}
