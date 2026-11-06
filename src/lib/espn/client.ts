import "server-only";
import type { z } from "zod";
import type { Sport } from "@/lib/domain/types";
import { AppError } from "@/lib/domain/errors";
import {
  ESPN_ALLOWED_HOSTS,
  ESPN_ALLOWED_VIEWS,
  ESPN_GAME_CODES,
  ESPN_READ_HOST,
} from "./constants";

export interface EspnCredentials {
  espnS2: string;
  swid: string;
}

export interface EspnRequestContext {
  sport: Sport;
  season: number;
  leagueId: string;
  credentials: EspnCredentials | null;
}

export type EspnEndpoint =
  | { kind: "league"; views: string[]; scoringPeriodId?: number; filter?: unknown }
  | { kind: "proSchedule" }
  | { kind: "players"; filter?: unknown };

export interface EspnClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const LEAGUE_PATH = /^\/apis\/v3\/games\/(ffl|fba)\/seasons\/\d{4}\/segments\/0\/leagues\/\d{1,12}$/;
const SEASON_PATH = /^\/apis\/v3\/games\/(ffl|fba)\/seasons\/\d{4}$/;
const PLAYERS_PATH = /^\/apis\/v3\/games\/(ffl|fba)\/seasons\/\d{4}\/players$/;

/**
 * Builds a request URL exclusively from validated parts. User input never
 * contributes a host or a path segment other than the numeric league id and
 * season, and the result is re-checked against the allowlist.
 */
export function buildEspnUrl(ctx: Pick<EspnRequestContext, "sport" | "season" | "leagueId">, endpoint: EspnEndpoint): URL {
  if (!/^\d{1,12}$/.test(ctx.leagueId)) {
    throw new AppError("BAD_REQUEST", "League id must be numeric.");
  }
  if (!Number.isInteger(ctx.season) || ctx.season < 2018 || ctx.season > 2100) {
    throw new AppError("BAD_REQUEST", "Season is out of the supported range.");
  }
  const game = ESPN_GAME_CODES[ctx.sport];
  if (!game) throw new AppError("BAD_REQUEST", "Unsupported sport.");

  const base = `https://${ESPN_READ_HOST}/apis/v3/games/${game}/seasons/${ctx.season}`;
  let url: URL;
  if (endpoint.kind === "league") {
    url = new URL(`${base}/segments/0/leagues/${ctx.leagueId}`);
    for (const v of endpoint.views) {
      if (!ESPN_ALLOWED_VIEWS.has(v)) throw new AppError("BAD_REQUEST", `View ${v} is not allowed.`);
      url.searchParams.append("view", v);
    }
    if (endpoint.scoringPeriodId !== undefined) {
      if (!Number.isInteger(endpoint.scoringPeriodId) || endpoint.scoringPeriodId < 0) {
        throw new AppError("BAD_REQUEST", "Invalid scoring period.");
      }
      url.searchParams.set("scoringPeriodId", String(endpoint.scoringPeriodId));
    }
  } else if (endpoint.kind === "proSchedule") {
    url = new URL(base);
    url.searchParams.append("view", "proTeamSchedules_wl");
  } else {
    // Public player pool (no league, no cookies): projections for all players.
    url = new URL(`${base}/players`);
    url.searchParams.set("scoringPeriodId", "0");
    url.searchParams.append("view", "kona_player_info");
  }
  assertAllowedUrl(url);
  return url;
}

export function assertAllowedUrl(url: URL): void {
  const pathOk = LEAGUE_PATH.test(url.pathname) || SEASON_PATH.test(url.pathname) || PLAYERS_PATH.test(url.pathname);
  if (url.protocol !== "https:" || !ESPN_ALLOWED_HOSTS.has(url.hostname) || url.port !== "" || !pathOk) {
    throw new AppError("BAD_REQUEST", "Refusing to call a non-allowlisted ESPN endpoint.");
  }
}

function cookieHeader(c: EspnCredentials): string {
  return `espn_s2=${c.espnS2}; SWID=${c.swid}`;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class EspnClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: EspnClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async get<S extends z.ZodType>(ctx: EspnRequestContext, endpoint: EspnEndpoint, schema: S): Promise<z.infer<S>> {
    const url = buildEspnUrl(ctx, endpoint);
    const headers: Record<string, string> = { Accept: "application/json" };
    if ((endpoint.kind === "league" || endpoint.kind === "players") && endpoint.filter !== undefined) {
      headers["x-fantasy-filter"] = JSON.stringify(endpoint.filter);
    }
    if (ctx.credentials && endpoint.kind === "league") {
      headers.Cookie = cookieHeader(ctx.credentials);
    }

    let lastError: AppError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(400 * 2 ** (attempt - 1));
      try {
        const body = await this.once(url, headers, ctx);
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          throw new AppError(
            "UPSTREAM_MALFORMED",
            "ESPN returned data in an unexpected shape. The unofficial ESPN API may have changed.",
          );
        }
        return parsed.data;
      } catch (e) {
        const err = e instanceof AppError
          ? e
          : new AppError("UPSTREAM_UNAVAILABLE", "Could not reach ESPN.", { retryable: true });
        if (!err.retryable) throw err;
        lastError = err;
      }
    }
    throw lastError ?? new AppError("UPSTREAM_UNAVAILABLE", "Could not reach ESPN.");
  }

  private async once(url: URL, headers: Record<string, string>, ctx: EspnRequestContext): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      if (controller.signal.aborted) {
        throw new AppError("UPSTREAM_TIMEOUT", "ESPN did not respond in time.", { retryable: true });
      }
      void e;
      throw new AppError("UPSTREAM_UNAVAILABLE", "Could not reach ESPN.", { retryable: true });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      if (!ctx.credentials) {
        throw new AppError(
          "AUTH_REQUIRED",
          "This league is private. Add your espn_s2 and SWID cookies to connect.",
        );
      }
      throw new AppError(
        "AUTH_INVALID",
        "ESPN rejected your cookies. They may be expired or copied incorrectly. Copy fresh espn_s2 and SWID values and reconnect.",
      );
    }
    // ESPN answers 400 ("Invalid parameter for 'leagueId'") for ids it cannot parse.
    if (res.status === 404 || res.status === 400) {
      throw new AppError(
        "LEAGUE_NOT_FOUND",
        "ESPN could not find that league for the selected sport and season. Check the league id, sport and season.",
      );
    }
    if (res.status === 429) {
      throw new AppError("RATE_LIMITED", "ESPN is rate limiting requests. Try again in a few minutes.", { retryable: true });
    }
    if (res.status >= 500) {
      throw new AppError("UPSTREAM_UNAVAILABLE", `ESPN is unavailable (HTTP ${res.status}).`, { retryable: true });
    }
    if (!res.ok) {
      throw new AppError("UPSTREAM_UNAVAILABLE", `ESPN returned HTTP ${res.status}.`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError(
        "UPSTREAM_MALFORMED",
        "ESPN returned a non-JSON response. The unofficial ESPN API may have changed.",
      );
    }
  }
}
