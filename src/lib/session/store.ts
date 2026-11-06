import { randomBytes } from "node:crypto";
import type { EspnCredentials } from "@/lib/espn/client";
import type { LeagueLocator } from "@/lib/domain/provider";
import type { LeagueSnapshot } from "@/lib/domain/types";
import type { AppErrorCode } from "@/lib/domain/errors";
import type { ExplanationResult } from "@/lib/ai/schema";
import type { CustomLeague } from "@/lib/custom/types";

export interface SyncState {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: { code: AppErrorCode; message: string } | null;
}

/**
 * Everything the server keeps for one browser session. Credentials live only
 * here (server memory) and are never serialized to the client.
 */
export interface SessionData {
  id: string;
  createdAt: number;
  lastAccessAt: number;
  /** Absolute expiry; the session is also dropped after IDLE_TTL_MS without use. */
  expiresAt: number;
  mode: "espn" | "demo" | "custom";
  locator: LeagueLocator;
  credentials: EspnCredentials | null;
  /** Editable league definition for custom mode; null otherwise. */
  customLeague: CustomLeague | null;
  /** Signed-in owner, or null for a guest. */
  userId: number | null;
  /** Row id of the saved copy of customLeague; edits are written back to it. */
  savedLeagueId: number | null;
  snapshot: LeagueSnapshot | null;
  sync: SyncState;
  inflight: Promise<LeagueSnapshot> | null;
  explanations: Map<string, ExplanationResult>;
  rateLog: Map<string, number[]>;
}

export const IDLE_TTL_MS = 2 * 60 * 60 * 1000;
export const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;

export type SessionLookup =
  | { status: "ok"; session: SessionData }
  | { status: "expired" }
  | { status: "missing" };

export type SessionInit = Pick<SessionData, "mode" | "locator" | "credentials" | "customLeague"> &
  Partial<Pick<SessionData, "userId" | "savedLeagueId">>;

export interface SessionStore {
  create(init: SessionInit): SessionData;
  get(id: string): SessionLookup;
  /** The live session owned by this user, if any. */
  forUser(userId: number): SessionData | null;
  delete(id: string): void;
  deleteForUser(userId: number): void;
}

/**
 * In-memory store keyed by an unguessable 256-bit id. Each session's data is
 * isolated under its own key; nothing is shared between sessions. Suitable for
 * a single-instance deployment; swap for Redis or similar (implementing
 * SessionStore) when running multiple instances.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionData>();
  /** Recently expired ids, so the UI can say "expired" rather than "not connected". */
  private readonly expired = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  create(init: SessionInit): SessionData {
    this.sweep();
    const t = this.now();
    const session: SessionData = {
      id: randomBytes(32).toString("base64url"),
      createdAt: t,
      lastAccessAt: t,
      expiresAt: t + ABSOLUTE_TTL_MS,
      userId: null,
      savedLeagueId: null,
      ...init,
      snapshot: null,
      sync: { lastSuccessAt: null, lastAttemptAt: null, lastError: null },
      inflight: null,
      explanations: new Map(),
      rateLog: new Map(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): SessionLookup {
    const s = this.sessions.get(id);
    const t = this.now();
    if (!s) return this.expired.has(id) ? { status: "expired" } : { status: "missing" };
    if (t >= s.expiresAt || t - s.lastAccessAt >= IDLE_TTL_MS) {
      this.expire(id);
      return { status: "expired" };
    }
    s.lastAccessAt = t;
    return { status: "ok", session: s };
  }

  forUser(userId: number): SessionData | null {
    for (const s of this.sessions.values()) {
      if (s.userId !== userId) continue;
      const found = this.get(s.id);
      if (found.status === "ok") return found.session;
    }
    return null;
  }

  deleteForUser(userId: number): void {
    for (const s of [...this.sessions.values()]) if (s.userId === userId) this.delete(s.id);
  }

  delete(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.credentials = null;
    this.sessions.delete(id);
    this.expired.delete(id);
  }

  private expire(id: string) {
    const s = this.sessions.get(id);
    if (s) s.credentials = null;
    this.sessions.delete(id);
    this.expired.set(id, this.now());
  }

  private sweep() {
    const t = this.now();
    for (const [id, s] of this.sessions) {
      if (t >= s.expiresAt || t - s.lastAccessAt >= IDLE_TTL_MS) this.expire(id);
    }
    for (const [id, at] of this.expired) if (t - at > ABSOLUTE_TTL_MS) this.expired.delete(id);
  }
}

const globalKey = Symbol.for("fta.sessionStore");
type GlobalWithStore = typeof globalThis & { [globalKey]?: SessionStore };

/** Process-wide store instance (survives dev hot reloads). */
export function sessionStore(): SessionStore {
  const g = globalThis as GlobalWithStore;
  g[globalKey] ??= new MemorySessionStore();
  return g[globalKey];
}
