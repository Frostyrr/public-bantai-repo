export const legacyRecoveryPath = "/password/reset?from=legacy-link";

export function isLegacyRecoveryCallback(hash: string): boolean {
  return new URLSearchParams(hash.replace(/^#/, "")).get("type") === "recovery";
}
