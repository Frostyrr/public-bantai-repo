import { extractApiErrorDetails } from "./sessionRecovery";

export const LOGIN_RESTRICTION_EVENT = "bantai:login-restriction";

export function formatRestrictionDuration(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return [hours && `${hours}h`, minutes && `${minutes}m`, (remaining || (!hours && !minutes)) && `${remaining}s`].filter(Boolean).join(" ");
}

export function getLoginRestriction(error: unknown, remainingSeconds?: number) {
  const { code, status, retryAfterSeconds } = extractApiErrorDetails(error);
  const seconds = remainingSeconds ?? retryAfterSeconds;
  const timing = seconds && seconds > 0 ? ` Retry in ${formatRestrictionDuration(seconds)}.` : "";
  if (status === 403 && code === "account_locked") {
    return { code, status, retryAfterSeconds, title: "Account temporarily locked", message: "Your account is temporarily locked. Wait for the lockout to expire or contact a platform administrator." + timing };
  }
  if (status === 403 && code === "account_suspended") {
    return { code, status, title: "Account suspended", message: "Your account has been suspended. Contact a platform administrator to restore access." };
  }
  if (status === 429 && code === "ip_restricted") {
    return { code, status, retryAfterSeconds, title: "IP restricted", message: "Sign-in from your network is temporarily restricted. Wait for the restriction to expire or contact a platform administrator." + timing };
  }
  if (status === 429 && code === "login_restricted") {
    return { code, status, retryAfterSeconds, title: "Sign-in temporarily locked", message: "Too many failed sign-in attempts. Wait for the lockout to expire before trying again." + timing };
  }
  return null;
}
