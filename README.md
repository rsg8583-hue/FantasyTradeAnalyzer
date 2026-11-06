# Fantasy Trade Analyzer

Build your own fantasy **football or basketball points league** — create teams, fill them from ESPN's real player pool, and estimate how a proposed trade changes each team's projected starting-lineup points. No ESPN account, league link, or cookies needed.

The app never proposes, accepts, or submits trades on ESPN. **Make this trade** only changes the rosters of a league you built in the app.

- **Live ESPN projections.** Players and their full-season projections come from ESPN's public player endpoint. You pick a scoring preset (PPR, Half-PPR, Standard, or a basketball points preset); the engine scores ESPN's projected stats with it.
- **Deterministic numbers.** Optimal lineups are recomputed before and after the trade, using your league's scoring and lineup rules.
- **AI explanations (optional).** OpenAI explains the computed results. It cannot change them, and its output is rejected if it contradicts them.
- **Accounts (optional).** Sign in with a username and password to save leagues, keep them through refreshes and server restarts, and open them from any device. Guests can still use everything; their leagues just aren't saved.
- **Demo mode.** A clearly labeled demo uses fictional fixture data.

See [docs/CALCULATION.md](docs/CALCULATION.md) for the full methodology.

## Setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # optional: add OPENAI_API_KEY / OPENAI_MODEL for AI explanations
npm run dev                  # http://localhost:3000
```

| Command | Purpose |
| --- | --- |
| `npm test` | Unit tests (vitest). Mocked ESPN and AI responses; no credentials or paid calls. |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run build && npm start` | Production build and server |

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | No | Without it, results show a deterministic explanation and an "AI not configured" notice. |
| `OPENAI_MODEL` | With the key | A Responses-API model that supports structured outputs. |
| `AI_PROVIDER` | No | Defaults to `openai` (the only provider implemented). |
| `DATABASE_PATH` | No | Local SQLite file for accounts and saved leagues. Defaults to `data/app.db` (created on first use, gitignored). Ignored when `TURSO_DATABASE_URL` is set. |
| `TURSO_DATABASE_URL` | On Vercel | Hosted [Turso](https://turso.tech) database (`libsql://…`) for accounts. Required on Vercel and other read-only hosts; without it, sign-in shows "Accounts aren't set up" and the rest of the app works as a guest. |
| `TURSO_AUTH_TOKEN` | With the URL | Turso database token. |

### Deploying to Vercel with accounts

1. Install the Turso CLI and sign in: `brew install tursodatabase/tap/turso && turso auth signup`.
2. `turso db create fantasy-trade-analyzer`
3. `turso db show fantasy-trade-analyzer --url` → set as `TURSO_DATABASE_URL` in Vercel (Project → Settings → Environment Variables).
4. `turso db tokens create fantasy-trade-analyzer` → set as `TURSO_AUTH_TOKEN`.
5. Redeploy. Tables are created automatically on first use.

No ESPN credentials are ever needed or stored. The player pool is public.

## Usage

1. On the home page, **Build a league**: name it, pick the sport, season, and scoring preset, then **Create league**. The app loads ESPN's player pool for that sport and season.
2. On the **Build league** tab:
   - Add two or more teams.
   - Select a team, then search ESPN's players (ranked by projected points under your scoring) and **Add** them. Remove players or rename/remove teams as needed.
3. On the **Trade builder** tab:
   - Pick Team A and Team B and check the players each sends.
   - If a team ends up over its roster limit, choose its drops.
   - Click **Analyze trade**.
4. Results show each team's projected-points change, a before/after optimal lineup, a verdict, and an AI explanation.
   In a league you built, **Make this trade** then moves the players between the two rosters (and removes any drops). It's only offered for a trade analyzed against the current rosters; if anything changed, re-analyze first.
5. **Refresh league** re-fetches ESPN's projections. **Close league** ends the session.

### Accounts

Use **Sign in** / **Create account** on the home page, or **Sign in to save** on a guest league's dashboard.

- Leagues you create while signed in are saved, and every edit is saved as you make it. Signing in while building a guest league saves that league to your account.
- The league you have open is reopened automatically after a refresh, a server restart, or on another device.
- **Close league** returns to **Your leagues** without deleting anything. Delete a league from that list.
- Demos are never saved.

Use **Demo: football** or **Demo: basketball** to try the app without building anything. Demo data is fictional and never substituted for real data.

## Architecture

```
src/lib/espn/         ESPN adapter: allowlisted URL builder + HTTP client (timeouts, retries),
                      response schemas, normalization, and the public player-pool fetch/cache.
src/lib/league/       Scoring + roster presets (PPR, Half-PPR, Standard, basketball points).
src/lib/custom/       Custom-league model, mutation rules, and the snapshot builder.
src/lib/demo/         Fictional fixture provider (same LeagueProvider interface).
src/lib/session/      Expiring server-side session store (opaque id → league + snapshot).
src/lib/accounts/     Password hashing and the SQLite/Turso store for users, login tokens, and saved leagues.
src/lib/server/       Route helpers (origin checks, cookies, rate limits) and league sync.
src/lib/projections/  Projection providers: full-season (custom) and weekly/daily (demo), plus scoring.
src/lib/engine/       Lineup optimizer (Hungarian) and trade validation/calculation.
src/lib/ai/           AI provider interface, OpenAI provider, minimal input builder, output
                      validation, deterministic fallback.
src/components/       UI
src/app/api/          custom (create/edit) · players (search) · demo · session · league · analyze · explain
                      · auth (signup/login/logout/me) · leagues (open/delete saved)
```

The old ESPN **league-linking** adapter (`src/lib/espn/provider.ts`, `leagueInput.ts`) and its tests are retained but no longer exposed in the UI. The app now reads only ESPN's public player pool.

## Security model

- **No ESPN credentials.** The app uses ESPN's public player pool, so there are no cookies or passwords to handle.
- **Session.** A league lives in server memory, keyed by a random 256-bit session id. The browser holds that id in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` outside localhost). Sessions expire after 2 hours idle or 12 hours total.
- **Accounts.** Guests never touch the database; it's opened only for requests with a sign-in cookie. Passwords are hashed with scrypt (random salt per user). Signing in sets a separate 30-day `HttpOnly`, `SameSite=Strict` cookie holding a random token; the database stores only its SHA-256 hash. Every saved-league query is scoped to the signed-in user. Sign-in and sign-up attempts are limited to 10 per username and 30 per address per 15 minutes, and unknown usernames take as long to reject as wrong passwords.
- **Requests.** State-changing routes require a same-origin `Origin` header. Inputs are schema-validated.
- **Outbound ESPN calls.** URLs are built only from an allowlisted host (`lm-api-reads.fantasy.espn.com`), fixed path patterns, and allowlisted views/filters. Redirects are not followed.
- **Rate limits per session.** Player pool: cached 6 hours, shared across callers. Search: 60/min. Edits: 120/min. Analyze: 30/min. AI explanations: 10 per 10 minutes, cached per trade.
- **Deployment caveat.** The in-memory session store and player-pool cache are for a single server instance. Running several instances needs a shared store (the session code has an interface for one). A restart clears both, but signed-in users' leagues are restored from the database. Each saved league has a version number that goes up on every save, so a server instance with an out-of-date copy reloads it instead of overwriting newer edits; this keeps signed-in leagues consistent across Vercel's multiple instances. Guest leagues remain per-instance.

## ESPN data: unofficial, with limitations

ESPN's fantasy API is **undocumented and unofficial**. It can change or break without notice, and this project is not affiliated with ESPN.

The endpoints and field meanings were taken from maintained community clients, chiefly [cwendt94/espn-api](https://github.com/cwendt94/espn-api) (host, views, stat-split encodings, slot and team maps).

The app makes two kinds of public request, with **no cookies**:

| Data | Request |
| --- | --- |
| Player pool with projections | `…/games/{ffl\|fba}/seasons/{season}/players?view=kona_player_info` |
| Pro schedule (demo only) | `…/seasons/{season}?view=proTeamSchedules_wl` |

### Verified

- The public players endpoint returns ESPN's full-season projected stat lines for football and basketball without any credentials. Scored by a preset, the rankings match real stars.
- The response is large (tens of MB); it is fetched once and cached for 6 hours.

### Known limitation: flaky projection values

ESPN's projection feed sometimes returns a corrupt stat value for a player (e.g. millions of yards). The scoring engine ignores any single stat value above 100,000, which removes the bad value while keeping the rest of the player's line. Subtler bad data cannot be detected and is an inherent limitation of an unofficial source. A player for whom ESPN returns no full-season projection is shown as having no projection, never a zero.
