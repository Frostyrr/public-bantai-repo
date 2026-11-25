export const MIN_ACTIVE_DURATION_SECONDS = 5;
export const MAX_DURATION_SECONDS = 2_592_000; // 30 days

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;

export type DurationUnit = "seconds" | "minutes" | "hours" | "days";

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface UnitRepresentation {
  value: number;
  unit: DurationUnit;
}

export const UNIT_MULTIPLIERS: Record<DurationUnit, number> = {
  seconds: 1,
  minutes: SECONDS_PER_MINUTE,
  hours: SECONDS_PER_HOUR,
  days: SECONDS_PER_DAY,
};

function sanitizeNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Splits a total-seconds value into days, hours, minutes, and seconds.
 */
export function decomposeSeconds(totalSeconds: number): DurationParts {
  const safe = sanitizeNonNegativeInt(totalSeconds);
  const days = Math.floor(safe / SECONDS_PER_DAY);
  const hours = Math.floor((safe % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((safe % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = safe % SECONDS_PER_MINUTE;
  return { days, hours, minutes, seconds };
}

/**
 * Recombines days, hours, minutes, and seconds into total seconds.
 */
export function composeSeconds(parts: Partial<DurationParts>): number {
  const days = sanitizeNonNegativeInt(parts.days ?? 0);
  const hours = sanitizeNonNegativeInt(parts.hours ?? 0);
  const minutes = sanitizeNonNegativeInt(parts.minutes ?? 0);
  const seconds = sanitizeNonNegativeInt(parts.seconds ?? 0);
  return (
    days * SECONDS_PER_DAY +
    hours * SECONDS_PER_HOUR +
    minutes * SECONDS_PER_MINUTE +
    seconds
  );
}

/**
 * Returns the cleanest single { value, unit } pair for a total-seconds value.
 */
export function getBestUnitRepresentation(totalSeconds: number): UnitRepresentation {
  const safe = sanitizeNonNegativeInt(totalSeconds);
  if (safe === 0) {
    return { value: 0, unit: "minutes" };
  }
  if (safe % SECONDS_PER_DAY === 0) {
    return { value: safe / SECONDS_PER_DAY, unit: "days" };
  }
  if (safe % SECONDS_PER_HOUR === 0) {
    return { value: safe / SECONDS_PER_HOUR, unit: "hours" };
  }
  if (safe % SECONDS_PER_MINUTE === 0) {
    return { value: safe / SECONDS_PER_MINUTE, unit: "minutes" };
  }
  return { value: safe, unit: "seconds" };
}

/**
 * Returns true when totalSeconds is cleanly represented by a single natural unit
 * (e.g., 15m, 2h, 1d, 30s) rather than a composite multi-unit value (e.g., 1h 30m).
 */
export function isSingleCleanUnit(totalSeconds: number): boolean {
  const safe = sanitizeNonNegativeInt(totalSeconds);
  if (safe === 0) return true;
  if (safe % SECONDS_PER_DAY === 0) return true;
  if (safe % SECONDS_PER_HOUR === 0) return true;
  if (safe < SECONDS_PER_HOUR && safe % SECONDS_PER_MINUTE === 0) return true;
  return safe < SECONDS_PER_MINUTE;
}

/**
 * Formats total seconds into a compact human-readable summary string.
 * Examples: 0 -> "Disabled", 86400 -> "1 day", 5400 -> "1 hr 30 min".
 */
export function formatDurationSummary(totalSeconds: number): string {
  const safe = sanitizeNonNegativeInt(totalSeconds);
  if (safe === 0) return "Disabled";

  const { days, hours, minutes, seconds } = decomposeSeconds(safe);
  const parts: string[] = [];

  if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hr" : "hrs"}`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0) parts.push(`${seconds} sec`);

  return parts.join(" ");
}

/**
 * Checks whether totalSeconds is either 0 (disabled) or within [5s, 30d].
 */
export function isValidDurationSeconds(totalSeconds: number): boolean {
  return (
    Number.isInteger(totalSeconds) &&
    (totalSeconds === 0 ||
      (totalSeconds >= MIN_ACTIVE_DURATION_SECONDS &&
        totalSeconds <= MAX_DURATION_SECONDS))
  );
}
