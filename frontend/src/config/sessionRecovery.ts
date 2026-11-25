export const SESSION_FETCH_TIMEOUT_MS = 8000;
export const SESSION_SIGN_OUT_TIMEOUT_MS = 3000;
export const USER_FETCH_TIMEOUT_MS = 15_000;

export async function withSessionDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ApiRequestError(message, {
          code: "session_check_timeout", isTimeout: true, isNetworkError: true,
        })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface MinimalSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user?: unknown;
}

export interface MinimalAuthClient {
  getSession: () => Promise<{ data: { session: MinimalSession | null }; error: unknown }>;
  signOut: (options?: { scope?: "local" | "global" | "others" }) => Promise<unknown>;
}

export interface SessionRecoveryState {
  inFlightSessionPromise: Promise<MinimalSession | null> | null;
  inFlightSignOutPromise: Promise<void> | null;
}

export function createSessionRecoveryState(): SessionRecoveryState {
  return {
    inFlightSessionPromise: null,
    inFlightSignOutPromise: null,
  };
}

const defaultRecoveryState = createSessionRecoveryState();

export interface ApiRequestErrorDetails {
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
  isNetworkError?: boolean;
  isTimeout?: boolean;
  issues?: unknown;
}

/**
 * Structured frontend API/session error preserving HTTP status and transient flags
 * without masking failures into generic network errors.
 */
export class ApiRequestError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;
  readonly isNetworkError: boolean;
  readonly isTimeout: boolean;
  readonly issues?: unknown;

  constructor(message: string, details: ApiRequestErrorDetails = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = details.status;
    this.code = details.code;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.isNetworkError = Boolean(details.isNetworkError);
    this.isTimeout = Boolean(details.isTimeout);
    this.issues = details.issues;
  }
}

interface ErrorResponseShape {
  status?: unknown;
  headers?: Record<string, unknown> & { get?: (name: string) => unknown };
  data?: {
    message?: unknown;
    code?: unknown;
    issues?: unknown;
  };
}

interface ErrorLikeShape {
  isAxiosError?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  status?: unknown;
  retryAfterSeconds?: unknown;
  response?: ErrorResponseShape;
}

function readRetryAfterSeconds(headers: ErrorResponseShape["headers"]): number | undefined {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  const rawValue =
    typeof headers.get === "function"
      ? headers.get("retry-after")
      : headers["retry-after"] ?? headers["Retry-After"];
  if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    const parsed = Number.parseInt(rawValue.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

const CONFIRMED_INVALID_REFRESH_RE =
  /invalid refresh token|refresh token not found|refresh_token_not_found|your session (?:timed out|has ended)|session_not_found|session from session_id claim|jwt malformed|bad_jwt/i;

export function isConfirmedInvalidRefreshError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  const code =
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  return CONFIRMED_INVALID_REFRESH_RE.test(message) || CONFIRMED_INVALID_REFRESH_RE.test(code);
}

function sessionId(token: string): string | undefined {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const id: unknown = JSON.parse(atob(payload)).session_id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

export function matchesSessionToken(current: string, rejected: string): boolean {
  const id = sessionId(current);
  return current === rejected || (id !== undefined && id === sessionId(rejected));
}

export function isConfirmedInvalidAuthStatus(status?: number, code?: string): boolean {
  return status === 401 || code === "session_expired" || code === "session_revoked" || code === "session_timed_out";
}

export function extractApiErrorDetails(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) {
    return error;
  }

  const shape = error && typeof error === "object" ? (error as ErrorLikeShape) : {};
  const response = shape.response;
  const status =
    typeof response?.status === "number"
      ? response.status
      : typeof shape.status === "number"
      ? shape.status
      : undefined;
  const responseMessage =
    typeof response?.data?.message === "string" && response.data.message.trim()
      ? response.data.message
      : undefined;
  const code =
    typeof response?.data?.code === "string"
      ? response.data.code
      : typeof shape.code === "string"
      ? shape.code
      : undefined;
  const retryAfterSeconds = readRetryAfterSeconds(response?.headers) ??
    (typeof shape.retryAfterSeconds === "number" && Number.isFinite(shape.retryAfterSeconds) && shape.retryAfterSeconds > 0
      ? Math.ceil(shape.retryAfterSeconds) : undefined);
  const rawMessage = typeof shape.message === "string" ? shape.message : "";
  const isTimeout =
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    shape.name === "TimeoutError" ||
    /timed?\s*out/i.test(rawMessage);
  const isNetworkError = status === undefined;

  let message = responseMessage;
  if (!message) {
    if (status === 429) {
      message = "Too many requests. Please wait a moment and try again.";
    } else if (status !== undefined && status >= 500) {
      message = "The server encountered a temporary error. Please try again.";
    } else if (isTimeout) {
      message = "Request timed out while contacting the server. Please try again.";
    } else if (!shape.isAxiosError && error instanceof Error && error.message.trim()) {
      message = error.message;
    } else {
      message = "Could not reach the server. Please try again.";
    }
  }

  return new ApiRequestError(message, {
    status,
    code,
    retryAfterSeconds,
    issues: response?.data?.issues,
    isNetworkError,
    isTimeout,
  });
}

export function clearConfirmedInvalidSession(
  authClient: Pick<MinimalAuthClient, "signOut">,
  state: SessionRecoveryState = defaultRecoveryState,
  timeoutMs = SESSION_SIGN_OUT_TIMEOUT_MS,
): Promise<void> {
  if (state.inFlightSignOutPromise) {
    return state.inFlightSignOutPromise;
  }
  const promise = withSessionDeadline(
    () => authClient.signOut({ scope: "local" }), timeoutMs,
    "Session cleanup timed out. Please sign in again.",
  )
    .then(
      () => undefined,
      () => undefined
    )
    .finally(() => {
      if (state.inFlightSignOutPromise === promise) {
        state.inFlightSignOutPromise = null;
      }
    });
  state.inFlightSignOutPromise = promise;
  return promise;
}

export interface ResolveSafeSessionOptions {
  timeoutMs?: number;
  state?: SessionRecoveryState;
}

export async function resolveSafeSession(
  authClient: MinimalAuthClient,
  options: ResolveSafeSessionOptions = {}
): Promise<MinimalSession | null> {
  const state = options.state ?? defaultRecoveryState;
  if (state.inFlightSessionPromise) {
    return state.inFlightSessionPromise;
  }

  const timeoutMs = options.timeoutMs ?? SESSION_FETCH_TIMEOUT_MS;
  const run = (async (): Promise<MinimalSession | null> => {
    try {
      const result = await withSessionDeadline(
        () => authClient.getSession(), timeoutMs,
        "Timed out while restoring your session. Please sign in again.",
      );
      if (result.error) {
        if (isConfirmedInvalidRefreshError(result.error)) {
          await clearConfirmedInvalidSession(authClient, state);
          return null;
        }
        throw result.error instanceof Error
          ? result.error
          : new ApiRequestError("Unable to verify your session. Please try again.", {
              isNetworkError: true,
            });
      }
      return result.data.session ?? null;
    } catch (error) {
      if (isConfirmedInvalidRefreshError(error)) {
        await clearConfirmedInvalidSession(authClient, state);
        return null;
      }
      throw error;
    }
  })().finally(() => {
    if (state.inFlightSessionPromise === run) {
      state.inFlightSessionPromise = null;
    }
  });

  state.inFlightSessionPromise = run;
  return run;
}

export interface ResolveAuthenticatedUserDeps<TUser> {
  auth: MinimalAuthClient;
  fetchUser: (session: MinimalSession) => Promise<TUser>;
  timeoutMs?: number;
  userFetchTimeoutMs?: number;
  state?: SessionRecoveryState;
  clearOnUnauthorized?: boolean;
}

export async function resolveAuthenticatedUser<TUser>({
  auth,
  fetchUser,
  clearOnUnauthorized = true,
  timeoutMs,
  userFetchTimeoutMs = USER_FETCH_TIMEOUT_MS,
  state = defaultRecoveryState,
}: ResolveAuthenticatedUserDeps<TUser>): Promise<TUser | null> {
  const session = await resolveSafeSession(auth, { timeoutMs, state });
  if (!session) {
    return null;
  }

  try {
    return await withSessionDeadline(
      () => fetchUser(session), userFetchTimeoutMs,
      "Checking your account took too long. Please sign in again.",
    );
  } catch (error) {
    const apiError = extractApiErrorDetails(error);
    if (isConfirmedInvalidAuthStatus(apiError.status, apiError.code)) {
      if (clearOnUnauthorized) await clearConfirmedInvalidSession(auth, state);
      return null;
    }
    throw apiError;
  }
}
