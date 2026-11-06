import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Client, InStatement } from "@libsql/client";
import type { CustomLeague } from "@/lib/custom/types";
import { AppError } from "@/lib/domain/errors";
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

/** A saved league plus its version, which goes up by one on every save. */
export interface SavedLeague {
  id: number;
  league: CustomLeague;
  version: number;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    active_league_id INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id)",
  `CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS leagues_user ON leagues(user_id)",
];

/** Only a hash of each login token is stored, so a leaked database can't be used to sign in. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

/**
 * Accounts, login tokens, and saved custom leagues in SQLite (a local file, or
 * Turso when deployed). Every league query is scoped by user id, so one user
 * can never read or change another's.
 */
export class AccountStore {
  private ready: Promise<void> | null = null;

  constructor(
    private readonly db: Client,
    private readonly now: () => number = Date.now,
  ) {}

  private async run(stmt: InStatement) {
    this.ready ??= this.db.batch(SCHEMA, "write").then(
      () => undefined,
      (e) => {
        this.ready = null;
        throw e;
      },
    );
    await this.ready;
    return this.db.execute(stmt);
  }

  /** Returns null if the username is taken (case-insensitive). */
  async createUser(username: string, passwordHash: string): Promise<AccountUser | null> {
    const r = await this.run({
      sql: "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(username) DO NOTHING RETURNING id",
      args: [username, passwordHash, this.now()],
    });
    return r.rows.length ? { id: Number(r.rows[0].id), username } : null;
  }

  async findUser(username: string): Promise<(AccountUser & { passwordHash: string }) | null> {
    const r = await this.run({ sql: "SELECT id, username, password_hash FROM users WHERE username = ?", args: [username] });
    const row = r.rows[0];
    return row ? { id: Number(row.id), username: String(row.username), passwordHash: String(row.password_hash) } : null;
  }

  async createToken(userId: number): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.run({ sql: "DELETE FROM auth_tokens WHERE expires_at <= ?", args: [this.now()] });
    await this.run({ sql: "INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)", args: [hashToken(token), userId, this.now() + AUTH_TTL_MS] });
    return token;
  }

  async userForToken(token: string): Promise<AccountUser | null> {
    const r = await this.run({
      sql: "SELECT u.id, u.username, t.expires_at FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?",
      args: [hashToken(token)],
    });
    const row = r.rows[0];
    if (!row) return null;
    if (Number(row.expires_at) <= this.now()) {
      await this.deleteToken(token);
      return null;
    }
    return { id: Number(row.id), username: String(row.username) };
  }

  async deleteToken(token: string): Promise<void> {
    await this.run({ sql: "DELETE FROM auth_tokens WHERE token_hash = ?", args: [hashToken(token)] });
  }

  async listLeagues(userId: number): Promise<SavedLeagueSummary[]> {
    const active = await this.activeLeagueId(userId);
    const r = await this.run({ sql: "SELECT id, data, updated_at FROM leagues WHERE user_id = ? ORDER BY updated_at DESC", args: [userId] });
    return r.rows.map((row) => {
      const l = JSON.parse(String(row.data)) as CustomLeague;
      const id = Number(row.id);
      return { id, name: l.name, sport: l.sport, season: l.season, teamCount: l.teams.length, updatedAt: new Date(Number(row.updated_at)).toISOString(), active: id === active };
    });
  }

  async getLeague(userId: number, leagueId: number): Promise<SavedLeague | null> {
    const r = await this.run({ sql: "SELECT data, version FROM leagues WHERE id = ? AND user_id = ?", args: [leagueId, userId] });
    const row = r.rows[0];
    return row ? { id: leagueId, league: JSON.parse(String(row.data)) as CustomLeague, version: Number(row.version) } : null;
  }

  async createLeague(userId: number, league: CustomLeague): Promise<SavedLeague> {
    const t = this.now();
    const r = await this.run({
      sql: "INSERT INTO leagues (user_id, data, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?) RETURNING id",
      args: [userId, JSON.stringify(league), t, t],
    });
    return { id: Number(r.rows[0].id), league, version: 1 };
  }

  /**
   * Saves only if the stored copy is still at `expectedVersion`, so a stale
   * copy (e.g. on another server instance) can't overwrite newer edits.
   * Returns the new version, or null if the save was rejected.
   */
  async updateLeague(userId: number, leagueId: number, league: CustomLeague, expectedVersion: number): Promise<number | null> {
    const r = await this.run({
      sql: "UPDATE leagues SET data = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND version = ? RETURNING version",
      args: [JSON.stringify(league), this.now(), leagueId, userId, expectedVersion],
    });
    return r.rows.length ? Number(r.rows[0].version) : null;
  }

  async deleteLeague(userId: number, leagueId: number): Promise<void> {
    await this.run({ sql: "DELETE FROM leagues WHERE id = ? AND user_id = ?", args: [leagueId, userId] });
    await this.run({ sql: "UPDATE users SET active_league_id = NULL WHERE id = ? AND active_league_id = ?", args: [userId, leagueId] });
  }

  /** The league the user last had open; restored automatically when their in-memory session is gone. */
  async activeLeague(userId: number): Promise<SavedLeague | null> {
    const id = await this.activeLeagueId(userId);
    return id === null ? null : this.getLeague(userId, id);
  }

  async setActiveLeague(userId: number, leagueId: number | null): Promise<void> {
    await this.run({ sql: "UPDATE users SET active_league_id = ? WHERE id = ?", args: [leagueId, userId] });
  }

  private async activeLeagueId(userId: number): Promise<number | null> {
    const r = await this.run({ sql: "SELECT active_league_id FROM users WHERE id = ?", args: [userId] });
    const v = r.rows[0]?.active_league_id;
    return v == null ? null : Number(v);
  }
}

/**
 * Turso when TURSO_DATABASE_URL is set (required on Vercel, whose disk is
 * read-only); otherwise a local file at DATABASE_PATH (default `data/app.db`).
 * Loaded on first use, so guests never depend on the database.
 */
export async function openDatabase(): Promise<Client> {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    const { createClient } = await import("@libsql/client/web");
    return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  if (process.env.VERCEL) {
    throw new AppError("CONFIG", "Accounts aren't set up on this server yet. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  }
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "app.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const { createClient } = await import("@libsql/client");
  const db = createClient({ url: `file:${file}` });
  await db.execute("PRAGMA foreign_keys = ON");
  return db;
}

const globalKey = Symbol.for("fta.accountStore");
type GlobalWithStore = typeof globalThis & { [globalKey]?: Promise<AccountStore> };

/** Process-wide store. A failed open is retried on the next call. */
export function accountStore(): Promise<AccountStore> {
  const g = globalThis as GlobalWithStore;
  g[globalKey] ??= openDatabase().then(
    (db) => new AccountStore(db),
    (e) => {
      delete g[globalKey];
      throw e;
    },
  );
  return g[globalKey];
}
