import type { AppErrorCode } from "./errors";
import type { LeagueLocator } from "./provider";
import type { LeagueSnapshot } from "./types";
import type { CustomLeague } from "@/lib/custom/types";

export interface SyncStatusDto {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: { code: AppErrorCode; message: string } | null;
  stale: boolean;
  credentialsRejected: boolean;
}

export interface LeagueStateResponse {
  connected: true;
  mode: "espn" | "demo" | "custom";
  locator: LeagueLocator;
  hasCredentials: boolean;
  expiresAt: string;
  snapshot: LeagueSnapshot | null;
  sync: SyncStatusDto;
  customLeague: CustomLeague | null;
}

export interface PlayerSearchResponse {
  players: {
    id: number;
    name: string;
    position: string;
    proTeam: string | null;
    injuryStatus: string | null;
    projectedPoints: number;
  }[];
}

export interface ApiErrorBody {
  error: { code: AppErrorCode | "INTERNAL"; message: string; details?: unknown };
}
