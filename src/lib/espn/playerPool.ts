import "server-only";
import { z } from "zod";
import type { Player, ScoringItem, Sport } from "@/lib/domain/types";
import { AppError } from "@/lib/domain/errors";
import { presetsForSport } from "@/lib/league/presets";
import { scoreSplit } from "@/lib/projections/scoring";
import { EspnClient, type EspnRequestContext } from "./client";
import { normalizePlayer } from "./normalize";
import { rawPlayerSchema } from "./schemas";

export interface PoolEntry {
  player: Player;
  /** Lowercased name for substring search. */
  searchName: string;
}

export interface PlayerPool {
  sport: Sport;
  season: number;
  fetchedAt: string;
  byId: Map<number, Player>;
  entries: PoolEntry[];
}

/** Request only season projected/total splits, to describe intent (ESPN may ignore it). */
function poolFilter(season: number) {
  return {
    players: {
      filterStatsForSplitTypeIds: { value: [0] },
      filterStatsForSourceIds: { value: [0, 1] },
      filterStatsForExternalIds: { value: [season] },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${season}`, `10${season}`] },
    },
  };
}

// The /players payload is large, so validate only that it is an array here and
// parse each entry tolerantly below.
const poolArraySchema = z.array(z.unknown());

/** Fetches and normalizes the public player pool (no league, no cookies). */
export async function fetchPlayerPool(sport: Sport, season: number, client: EspnClient): Promise<PlayerPool> {
  const ctx: EspnRequestContext = { sport, season, leagueId: "0", credentials: null };
  const raw = await client.get(ctx, { kind: "players", filter: poolFilter(season) }, poolArraySchema);

  // Only players who can start somewhere in this sport's leagues (drops head coaches, punters, etc.).
  const starterSlots = new Set(presetsForSport(sport).flatMap((p) => p.slots.filter((s) => s.kind === "starter").map((s) => s.slotId)));
  const byId = new Map<number, Player>();
  const entries: PoolEntry[] = [];
  for (const item of raw) {
    const parsed = rawPlayerSchema.safeParse(item);
    if (!parsed.success) continue;
    const player = normalizePlayer(parsed.data, sport, season);
    // Keep only players ESPN gives a usable season projection for.
    if (!player.projections.season?.stats || Object.keys(player.projections.season.stats).length === 0) continue;
    if (player.position === "?") continue;
    if (!player.eligibleSlotIds.some((id) => starterSlots.has(id))) continue;
    byId.set(player.id, player);
    entries.push({ player, searchName: player.name.toLowerCase() });
  }
  if (entries.length === 0) {
    throw new AppError("UPSTREAM_MALFORMED", "ESPN returned no projectable players. The unofficial player endpoint may have changed.");
  }
  return { sport, season, fetchedAt: new Date().toISOString(), byId, entries };
}

export interface PlayerSearchResult {
  id: number;
  name: string;
  position: string;
  proTeam: string | null;
  injuryStatus: string | null;
  projectedPoints: number;
}

/** Name search (empty query → best projected). Ranked by projected points under the given scoring. */
export function searchPool(pool: PlayerPool, query: string, scoringItems: ScoringItem[], limit = 40, exclude: Set<number> = new Set()): PlayerSearchResult[] {
  const q = query.trim().toLowerCase();
  const scored: PlayerSearchResult[] = [];
  for (const { player, searchName } of pool.entries) {
    if (exclude.has(player.id)) continue;
    if (q && !searchName.includes(q)) continue;
    const s = scoreSplit(player.projections.season, "total", scoringItems, player.positionSlotId);
    scored.push({
      id: player.id,
      name: player.name,
      position: player.position,
      proTeam: player.proTeamAbbrev,
      injuryStatus: player.injuryStatus,
      projectedPoints: s ? s.points : 0,
    });
  }
  scored.sort((a, b) => b.projectedPoints - a.projectedPoints);
  return scored.slice(0, limit);
}

// ---- Process-wide cache with request de-duplication and a long TTL. ----

interface CacheSlot {
  pool: PlayerPool | null;
  at: number;
  inflight: Promise<PlayerPool> | null;
}

const POOL_TTL_MS = 6 * 60 * 60 * 1000;
const cacheKey = Symbol.for("fta.playerPoolCache");
type GlobalWithCache = typeof globalThis & { [cacheKey]?: Map<string, CacheSlot> };

function cache(): Map<string, CacheSlot> {
  const g = globalThis as GlobalWithCache;
  g[cacheKey] ??= new Map();
  return g[cacheKey];
}

/** Returns a cached pool, sharing one in-flight fetch across concurrent callers. */
export async function getPlayerPool(
  sport: Sport,
  season: number,
  opts: { force?: boolean; client?: EspnClient; now?: () => number } = {},
): Promise<PlayerPool> {
  const now = opts.now ?? Date.now;
  const client = opts.client ?? new EspnClient({ timeoutMs: 30_000, maxRetries: 1 });
  const key = `${sport}:${season}`;
  const slot = cache().get(key) ?? { pool: null, at: 0, inflight: null };
  cache().set(key, slot);

  if (!opts.force && slot.pool && now() - slot.at < POOL_TTL_MS) return slot.pool;
  if (slot.inflight) return slot.inflight;

  const run = fetchPlayerPool(sport, season, client)
    .then((pool) => {
      slot.pool = pool;
      slot.at = now();
      return pool;
    })
    .finally(() => {
      slot.inflight = null;
    });
  slot.inflight = run;
  // On failure keep any previous pool; surface the error to this caller.
  return run;
}
