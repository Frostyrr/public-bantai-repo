import { env } from "../constants/env";

function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

const allowlist = new Set(
  (env.ADMIN_IP_ALLOWLIST ?? "")
    .split(",")
    .map(normalizeIp)
    .filter(Boolean),
);

/**
 * Trusted admin / office IPs are never IP-blocked or IP-throttled.
 * Per-account lockouts still apply to them.
 */
export function isAllowlistedIp(ip: string | undefined | null): boolean {
  return Boolean(ip) && allowlist.size > 0 && allowlist.has(normalizeIp(ip!));
}
