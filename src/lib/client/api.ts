import type { AccountResponse, ApiErrorBody, LeagueStateResponse, PlayerSearchResponse } from "@/lib/domain/apiTypes";
import type { CustomAction, TradeRequest } from "@/lib/domain/apiSchemas";
import type { TradeAnalysis } from "@/lib/engine/types";
import type { ExplanationResult } from "@/lib/ai/schema";

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("NETWORK", "Could not reach the app server. Check your connection.", 0);
  }
  const body = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? `Request failed (HTTP ${res.status}).`, res.status, err?.details);
  }
  return body as T;
}

export const api = {
  session: () => call<LeagueStateResponse>("/api/session"),
  createCustom: (body: { name: string; sport: string; season: number; presetId: string }) =>
    call<LeagueStateResponse>("/api/custom", { method: "POST", body: JSON.stringify(body) }),
  editCustom: (action: CustomAction) => call<LeagueStateResponse>("/api/custom", { method: "PATCH", body: JSON.stringify(action) }),
  searchPlayers: (q: string, limit = 40) =>
    call<PlayerSearchResponse>(`/api/players?q=${encodeURIComponent(q)}&limit=${limit}`),
  demo: (sport: string) => call<LeagueStateResponse>("/api/demo", { method: "POST", body: JSON.stringify({ sport }) }),
  disconnect: () => call<{ connected: false }>("/api/session", { method: "DELETE" }),
  poll: () => call<LeagueStateResponse>("/api/league"),
  refresh: () => call<LeagueStateResponse>("/api/league", { method: "POST" }),
  analyze: (req: TradeRequest) => call<TradeAnalysis>("/api/analyze", { method: "POST", body: JSON.stringify(req) }),
  explain: (req: TradeRequest) => call<ExplanationResult>("/api/explain", { method: "POST", body: JSON.stringify(req) }),
  me: () => call<AccountResponse>("/api/auth/me"),
  signup: (body: { username: string; password: string }) => call<{ user: { username: string } }>("/api/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { username: string; password: string }) => call<{ user: { username: string } }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => call<{ user: null }>("/api/auth/logout", { method: "POST" }),
  openLeague: (id: number) => call<LeagueStateResponse>("/api/leagues", { method: "POST", body: JSON.stringify({ id }) }),
  deleteLeague: (id: number) => call<AccountResponse>("/api/leagues", { method: "DELETE", body: JSON.stringify({ id }) }),
};

export const SESSION_GONE = new Set(["SESSION_EXPIRED", "NO_SESSION"]);
