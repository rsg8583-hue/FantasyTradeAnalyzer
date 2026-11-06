export type AppErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "LEAGUE_NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_MALFORMED"
  | "BAD_REQUEST"
  | "SESSION_EXPIRED"
  | "NO_SESSION"
  | "FORBIDDEN"
  | "CONFLICT"
  | "CONFIG"
  | "UNSUPPORTED_FORMAT";

const STATUS: Record<AppErrorCode, number> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  LEAGUE_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_MALFORMED: 502,
  BAD_REQUEST: 400,
  SESSION_EXPIRED: 401,
  NO_SESSION: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  CONFIG: 503,
  UNSUPPORTED_FORMAT: 422,
};

/**
 * Error whose message is safe to show to the user. Messages must never contain
 * credentials, cookie values or upstream URLs with secrets.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    opts: { retryable?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
