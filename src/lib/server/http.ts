import "server-only";
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { AppError, isAppError } from "@/lib/domain/errors";
import { AUTH_TTL_MS, accountStore } from "@/lib/accounts/store";
import { ABSOLUTE_TTL_MS, sessionStore, type SessionData, type SessionInit } from "@/lib/session/store";
import { AUTH_COOKIE, currentUser, refreshFromSaved, restoreUserSession } from "./accounts";

export const SESSION_COOKIE = "fta_session";

const isProd = () => process.env.NODE_ENV === "production";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function requestHost(req: NextRequest): string {
  return (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host).split(",")[0].trim();
}

/**
 * Credentials may only arrive over HTTPS. Plain HTTP is accepted only for
 * localhost development.
 */
export function assertSecureTransport(req: NextRequest): void {
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0].trim();
  if (proto === "https") return;
  const hostname = requestHost(req).replace(/:\d+$/, "");
  if (LOCAL_HOSTS.has(hostname)) return;
  throw new AppError("FORBIDDEN", "Credentials can only be sent over HTTPS.");
}

/** Rejects cross-site state-changing requests (defense in depth with SameSite=Strict). */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) throw new AppError("FORBIDDEN", "Missing Origin header.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Invalid Origin header.");
  }
  if (originHost !== requestHost(req)) throw new AppError("FORBIDDEN", "Cross-origin request rejected.");
}

function isLocalRequest(req: NextRequest): boolean {
  return LOCAL_HOSTS.has(requestHost(req).replace(/:\d+$/, ""));
}

/** Secure everywhere except plain-HTTP localhost (some browsers drop Secure cookies there). */
function setCookie(res: NextResponse, req: NextRequest, name: string, value: string, maxAgeMs: number) {
  res.cookies.set(name, value, {
    httpOnly: true,
    secure: isProd() ? !isLocalRequest(req) || req.nextUrl.protocol === "https:" : false,
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export function setSessionCookie(res: NextResponse, session: SessionData, req: NextRequest) {
  setCookie(res, req, SESSION_COOKIE, session.id, ABSOLUTE_TTL_MS);
}

export function setAuthCookie(res: NextResponse, token: string, req: NextRequest) {
  setCookie(res, req, AUTH_COOKIE, token, AUTH_TTL_MS);
}

/** Expiring a cookie does not need the Secure flag, which keeps this valid on localhost too. */
export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(AUTH_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
}

/**
 * Replaces the caller's current session (and, when signed in, the user's
 * sessions on other devices) with a new one.
 */
export function startSession(req: NextRequest, init: SessionInit): SessionData {
  const store = sessionStore();
  const previous = req.cookies.get(SESSION_COOKIE)?.value;
  if (previous) store.delete(previous);
  if (init.userId != null) store.deleteForUser(init.userId);
  return store.create(init);
}

/**
 * The caller's session. A signed-in user whose session is gone (restart, idle
 * expiry, another device or server instance) gets their active saved league
 * back instead of an error, kept in sync with the saved copy. A session
 * belonging to someone else is never returned.
 */
export async function requireSession(req: NextRequest): Promise<SessionData> {
  const id = req.cookies.get(SESSION_COOKIE)?.value;
  const found = id ? sessionStore().get(id) : null;
  const signedIn = req.cookies.has(AUTH_COOKIE);
  // Guest fast path: no database access.
  if (found?.status === "ok" && found.session.userId === null && !signedIn) return found.session;

  if (signedIn) {
    const accounts = await accountStore();
    const user = await currentUser(req, accounts);
    if (user) {
      const session = found?.status === "ok" && found.session.userId === user.id ? found.session : await restoreUserSession(user, accounts);
      if (session) {
        if (await refreshFromSaved(session, accounts)) return session;
        sessionStore().delete(session.id);
      }
      throw new AppError("NO_SESSION", "Not connected to a league.");
    }
    if (found?.status === "ok" && found.session.userId === null) return found.session;
  }

  if (!found) throw new AppError("NO_SESSION", "Not connected to a league.");
  if (found.status === "expired") {
    throw new AppError("SESSION_EXPIRED", "Your session expired and stored credentials were deleted. Reconnect to continue.");
  }
  if (found.status === "missing") {
    throw new AppError("NO_SESSION", "Not connected to a league. The server may have restarted; reconnect to continue.");
  }
  // A live session owned by a user who isn't signed in here.
  throw new AppError("NO_SESSION", "Not connected to a league.");
}

/**
 * Sliding-window limiter scoped to one session; returns false when the bucket
 * is full.
 */
export function allowRate(session: SessionData, bucket: string, max: number, windowMs: number, now = Date.now()): boolean {
  const log = (session.rateLog.get(bucket) ?? []).filter((t) => now - t < windowMs);
  if (log.length >= max) {
    session.rateLog.set(bucket, log);
    return false;
  }
  log.push(now);
  session.rateLog.set(bucket, log);
  return true;
}

export function errorResponse(e: unknown): NextResponse {
  // Let Next.js's own control-flow errors (e.g. the build-time "uses request data" bail-out) through.
  unstable_rethrow(e);
  if (isAppError(e)) {
    const body: Record<string, unknown> = { error: { code: e.code, message: e.message } };
    if (e.details) (body.error as Record<string, unknown>).details = e.details;
    const res = NextResponse.json(body, { status: e.status });
    if (e.code === "SESSION_EXPIRED") clearSessionCookie(res);
    return res;
  }
  // Log only the error type; never the request body (which may contain cookies).
  console.error("Unhandled server error:", e instanceof Error ? e.name : typeof e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Unexpected server error." } }, { status: 500 });
}

export async function readJson(req: NextRequest, maxBytes = 16_384): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("BAD_REQUEST", "Request body too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.");
  }
}

export const noStore = { "Cache-Control": "no-store" };
