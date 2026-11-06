import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { CustomLeague } from "@/lib/custom/types";
import type { Sport } from "@/lib/domain/types";

export const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccountUser {
  id: number;
  username: string;
}

export interface SavedLeagueSummary {
  id: number;
  name: string;
  sport: Sport;
  season: number;
  teamCount: number;
  updatedAt: string;
  active: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  active_league_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);
CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS leagues_user ON leagues(user_id);
`;

/** Only a hash of each login token is stored, so a leaked database can't be used to sign in. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

/**
 * Accounts, login tokens, and saved custom leagues in SQLite. Every league
 * query is scoped by user id, so one user can never read or change another's.
 */
export class AccountStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
  }

  /** Returns null if the username is taken (case-insensitive). */
  createUser(username: string, passwordHash: string): AccountUser | null {
    try {
      const r = this.db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)").run(username, passwordHash, this.now());
      return { id: Number(r.lastInsertRowid), username };
    } catch (e) {
      if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return null;
      throw e;
    }
  }

  findUser(username: string): (AccountUser & { passwordHash: string }) | null {
    const row = this.db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username) as
      | { id: number; username: string; password_hash: string }
      | undefined;
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : null;
  }

  userById(id: number): AccountUser | null {
    return (this.db.prepare("SELECT id, username FROM users WHERE id = ?").get(id) as AccountUser | undefined) ?? null;
  }

  createToken(userId: number): string {
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM auth_tokens WHERE expires_at <= ?").run(this.now());
    this.db.prepare("INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hashToken(token), userId, this.now() + AUTH_TTL_MS);
    return token;
  }

  userForToken(token: string): AccountUser | null {
    const row = this.db
      .prepare("SELECT u.id, u.username, t.expires_at FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?")
      .get(hashToken(token)) as (AccountUser & { expires_at: number }) | undefined;
    if (!row) return null;
    if (row.expires_at <= this.now()) {
      this.deleteToken(token);
      return null;
    }
    return { id: row.id, username: row.username };
  }

  deleteToken(token: string): void {
    this.db.prepare("DELETE FROM auth_tokens WHERE token_hash = ?").run(hashToken(token));
  }

  listLeagues(userId: number): SavedLeagueSummary[] {
    const active = this.activeLeagueId(userId);
    const rows = this.db.prepare("SELECT id, data, updated_at FROM leagues WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as {
      id: number;
      data: string;
      updated_at: number;
    }[];
    return rows.map((r) => {
      const l = JSON.parse(r.data) as CustomLeague;
      return { id: r.id, name: l.name, sport: l.sport, season: l.season, teamCount: l.teams.length, updatedAt: new Date(r.updated_at).toISOString(), active: r.id === active };
    });
  }

  getLeague(userId: number, leagueId: number): CustomLeague | null {
    const row = this.db.prepare("SELECT data FROM leagues WHERE id = ? AND user_id = ?").get(leagueId, userId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as CustomLeague) : null;
  }

  createLeague(userId: number, league: CustomLeague): number {
    const t = this.now();
    const r = this.db.prepare("INSERT INTO leagues (user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)").run(userId, JSON.stringify(league), t, t);
    return Number(r.lastInsertRowid);
  }

  updateLeague(userId: number, leagueId: number, league: CustomLeague): void {
    this.db.prepare("UPDATE leagues SET data = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(league), this.now(), leagueId, userId);
  }

  deleteLeague(userId: number, leagueId: number): void {
    this.db.prepare("DELETE FROM leagues WHERE id = ? AND user_id = ?").run(leagueId, userId);
    this.db.prepare("UPDATE users SET active_league_id = NULL WHERE id = ? AND active_league_id = ?").run(userId, leagueId);
  }

  /** The league the user last had open; restored automatically when their in-memory session is gone. */
  activeLeague(userId: number): { id: number; league: CustomLeague } | null {
    const id = this.activeLeagueId(userId);
    if (id === null) return null;
    const league = this.getLeague(userId, id);
    return league ? { id, league } : null;
  }

  setActiveLeague(userId: number, leagueId: number | null): void {
    this.db.prepare("UPDATE users SET active_league_id = ? WHERE id = ?").run(leagueId, userId);
  }

  private activeLeagueId(userId: number): number | null {
    const row = this.db.prepare("SELECT active_league_id FROM users WHERE id = ?").get(userId) as { active_league_id: number | null } | undefined;
    return row?.active_league_id ?? null;
  }
}

const globalKey = Symbol.for("fta.accountStore");
type GlobalWithStore = typeof globalThis & { [globalKey]?: AccountStore };

/** Process-wide store, opened lazily at DATABASE_PATH (default `data/app.db`). */
export function accountStore(): AccountStore {
  const g = globalThis as GlobalWithStore;
  if (!g[globalKey]) {
    const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "app.db");
    mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    g[globalKey] = new AccountStore(db);
  }
  return g[globalKey];
}
