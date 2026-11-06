import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { AppError, isAppError } from "@/lib/domain/errors";
import { ABSOLUTE_TTL_MS, sessionStore, type SessionData } from "@/lib/session/store";

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
export function setSessionCookie(res: NextResponse, session: SessionData, req: NextRequest) {
  res.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: isProd() ? !isLocalRequest(req) || req.nextUrl.protocol === "https:" : false,
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(ABSOLUTE_TTL_MS / 1000),
  });
}

/** Expiring a cookie does not need the Secure flag, which keeps this valid on localhost too. */
export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
}

export function requireSession(req: NextRequest): SessionData {
  const id = req.cookies.get(SESSION_COOKIE)?.value;
  if (!id) throw new AppError("NO_SESSION", "Not connected to a league.");
  const found = sessionStore().get(id);
  if (found.status === "expired") {
    throw new AppError("SESSION_EXPIRED", "Your session expired and stored credentials were deleted. Reconnect to continue.");
  }
  if (found.status === "missing") {
    throw new AppError("NO_SESSION", "Not connected to a league. The server may have restarted; reconnect to continue.");
  }
  return found.session;
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
