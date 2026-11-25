import axios from "axios";
import queryClient from "./queryClient";
import { invalidateFinancialWrite } from "../utils/financialCache";
import { promptSessionTimeout, supabase } from "./supabase";
import { getLoginRestriction, LOGIN_RESTRICTION_EVENT } from "./loginRestriction";
import {
  clearConfirmedInvalidSession,
  ApiRequestError,
  extractApiErrorDetails,
  isConfirmedInvalidAuthStatus,
  matchesSessionToken,
  resolveSafeSession,
} from "./sessionRecovery";

export interface FinancialReadRequest {
  signal?: AbortSignal;
  expectedUserId: string;
}

function hasAuthorizationHeader(headers: unknown): boolean {
  if (!headers || typeof headers !== "object") {
    return false;
  }
  const candidate = headers as { get?: (name: string) => unknown; Authorization?: unknown };
  return Boolean(
    typeof candidate.get === "function" ? candidate.get("Authorization") : candidate.Authorization
  );
}

export async function clearRejectedBrowserSession(accessToken: string, timedOut: boolean) {
  const current = await resolveSafeSession(supabase.auth).catch(() => null);
  if (!current || !matchesSessionToken(current.access_token, accessToken)) return;
  if (timedOut) promptSessionTimeout();
  // The Auth logout operation can remove the live session, while the server
  // ledger retains the original end reason for the admin directory.
  await clearConfirmedInvalidSession(supabase.auth);
}

const API = axios.create({ baseURL: import.meta.env.VITE_APP_URL || "http://localhost:4004", timeout: 15000 });
API.interceptors.request.use(async (config) => {
  const requestUrl = String(config.url ?? "");
  if (requestUrl.includes("/analytics/heartbeat")) {
    return config;
  }
  if (hasAuthorizationHeader(config.headers)) {
    return config;
  }
  const session = await resolveSafeSession(supabase.auth);
  const expectedUserId = (config as Partial<FinancialReadRequest>).expectedUserId;
  const user = session?.user;
  if (expectedUserId && (!user || typeof user !== "object" || !("id" in user) || user.id !== expectedUserId)) {
    throw new ApiRequestError("Your workspace session has changed.", { status: 401 });
  }
  if (session) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});
API.interceptors.response.use(
  (response) => {
    invalidateFinancialWrite(queryClient, response.config.method, response.config.url);
    return response;
  },
  async (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && error.response.data instanceof Blob) {
      try {
        error.response.data = JSON.parse(await error.response.data.text());
      } catch {
        // Use the HTTP status when the response body is unavailable.
      }
    }
    const apiError = extractApiErrorDetails(error);
    const restriction = getLoginRestriction(apiError);
    if (restriction) {
      window.dispatchEvent(new CustomEvent(LOGIN_RESTRICTION_EVENT, { detail: restriction }));
    }
    const config = axios.isAxiosError(error) ? error.config : undefined;
    const authorization = config?.headers.get("Authorization");
    if (
      typeof authorization === "string" &&
      !config?.url?.includes("/auth/login") &&
      isConfirmedInvalidAuthStatus(apiError.status, apiError.code)
    ) {
      await clearRejectedBrowserSession(authorization.replace(/^Bearer /i, ""), apiError.code === "session_timed_out");
    }
    return Promise.reject(apiError);
  }
);
export default API;
