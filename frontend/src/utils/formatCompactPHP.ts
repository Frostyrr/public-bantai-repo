export const CURRENCY_SYMBOLS: Record<string, string> = {
  PHP: "₱",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CAD: "CA$",
  AUD: "A$",
  SGD: "S$",
};

const COMPACT_TIERS = [
  { threshold: 1_000, suffix: "K" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000_000_000, suffix: "T" },
] as const;

function stripTrailingZeros(fixed: string): string {
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Resolves a currency code or symbol into its display prefix.
 * PHP and ₱ resolve to "₱"; unknown alphanumeric codes keep a trailing space (e.g. "CHF ").
 */
export function resolveCurrencyPrefix(currency = "PHP"): string {
  const trimmed = currency.trim();
  if (!trimmed || trimmed.toUpperCase() === "PHP" || trimmed === "₱") {
    return "₱";
  }
  const upper = trimmed.toUpperCase();
  if (upper in CURRENCY_SYMBOLS) {
    return CURRENCY_SYMBOLS[upper];
  }
  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) {
    return trimmed;
  }
  return `${upper} `;
}

/**
 * Formats a numeric value (major currency units):
 * - Below 100,000: full amount with thousands separators, trimming unnecessary .00
 * - 100,000 to <1,000,000: compact K notation (up to 5 significant digits, e.g. 153.25K)
 * - 1,000,000+: compact M/B/T notation with up to 5 significant digits and no trailing zeros
 * Never rounds across magnitude thresholds (e.g., 999,995 stays 999.99K; 999,995,000 stays 999.99M).
 */
export function formatCompactNumber(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  const abs = Math.abs(amount);
  const totalCents = Math.round(abs * 100);
  if (totalCents === 0) return "0";

  const sign = amount < 0 ? "-" : "";
  const normalizedAbs = totalCents / 100;

  if (totalCents < 10_000_000) {
    const wholePesos = Math.floor(totalCents / 100);
    const centavosPart = totalCents % 100;
    const formattedWhole = wholePesos.toLocaleString("en-US");
    if (centavosPart === 0) {
      return `${sign}${formattedWhole}`;
    }
    return `${sign}${formattedWhole}.${String(centavosPart).padStart(2, "0")}`;
  }

  let tierIdx = 0;
  for (let i = COMPACT_TIERS.length - 1; i >= 0; i -= 1) {
    if (normalizedAbs >= COMPACT_TIERS[i].threshold) {
      tierIdx = i;
      break;
    }
  }

  const tier = COMPACT_TIERS[tierIdx];
  const scaled = normalizedAbs / tier.threshold;
  let decimals = scaled < 10 ? 4 : scaled < 100 ? 3 : 2;
  const stepCents = (tier.threshold * 100) / (10 ** decimals);
  let rounded = Math.round(totalCents / stepCents) / (10 ** decimals);

  if (rounded >= 1000 && tierIdx < COMPACT_TIERS.length - 1) {
    decimals = 2;
    rounded = 999.99;
  } else if (rounded >= 100 && decimals > 2) {
    decimals = 2;
    rounded = Math.min(999.99, Math.round(totalCents / ((tier.threshold * 100) / 100)) / 100);
  } else if (rounded >= 10 && decimals > 3) {
    decimals = 3;
    rounded = Math.round(totalCents / ((tier.threshold * 100) / 1000)) / 1000;
    if (rounded >= 100) {
      decimals = 2;
      rounded = 100;
    }
  }

  return `${sign}${stripTrailingZeros(rounded.toFixed(decimals))}${tier.suffix}`;
}

/** Accepts pesos (major units), rather than the centavos used by API records. */
export function formatCompactPHP(amount: number, currency = "PHP"): string {
  const prefix = resolveCurrencyPrefix(currency);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const totalCents = Math.round(Math.abs(safeAmount) * 100);
  if (totalCents === 0) {
    return `${prefix}0`;
  }
  const sign = safeAmount < 0 ? "-" : "";
  return `${sign}${prefix}${formatCompactNumber(Math.abs(safeAmount))}`;
}

/** Accepts minor units (centavos) as number, bigint, or numeric string. */
export function formatCompactCurrency(
  centavos: number | bigint | string,
  currency = "PHP",
): string {
  const numericCentavos =
    typeof centavos === "bigint"
      ? Number(centavos)
      : typeof centavos === "string"
        ? (centavos.trim() ? Number(centavos) : 0)
        : centavos;
  const pesos = Number.isFinite(numericCentavos) ? numericCentavos / 100 : 0;
  return formatCompactPHP(pesos, currency);
}

/**
 * Formats centavos for compact mobile viewports using up to 5 significant digits.
 */
export function formatMobileCompactCurrency(centavos: number, currency = "PHP"): string {
  return formatCompactCurrency(centavos, currency);
}

/**
 * Formats minor units (centavos) with thousands separators and 2 decimal places
 * (e.g. ₱1,532,456.78). Uses BigInt arithmetic for exact integer/string inputs.
 */
export function formatExactCurrency(
  centavos: number | bigint | string,
  currency = "PHP",
): string {
  const prefix = resolveCurrencyPrefix(currency);

  const formatBigIntCents = (value: bigint): string => {
    if (value === 0n) return `${prefix}0.00`;
    const isNegative = value < 0n;
    const abs = isNegative ? -value : value;
    const whole = (abs / 100n).toLocaleString("en-US");
    const fraction = String(abs % 100n).padStart(2, "0");
    return `${isNegative ? "-" : ""}${prefix}${whole}.${fraction}`;
  };

  if (typeof centavos === "bigint") {
    return formatBigIntCents(centavos);
  }

  if (typeof centavos === "string") {
    const trimmed = centavos.trim();
    if (/^-?\d+$/.test(trimmed)) {
      return formatBigIntCents(BigInt(trimmed));
    }
    const parsed = trimmed ? Number(trimmed) : 0;
    return formatExactCurrency(Number.isFinite(parsed) ? parsed : 0, currency);
  }

  const safeCentavos = Number.isFinite(centavos) ? Math.round(centavos) : 0;
  if (safeCentavos === 0) {
    return `${prefix}0.00`;
  }
  if (Number.isSafeInteger(safeCentavos)) {
    return formatBigIntCents(BigInt(safeCentavos));
  }

  const isNegative = safeCentavos < 0;
  const absAmount = Math.abs(safeCentavos) / 100;
  const formatted = absAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNegative ? "-" : ""}${prefix}${formatted}`;
}

/** Accepts pesos (major units) and formats with thousands separators and 2 decimal places. */
export function formatExactPHP(amount: number, currency = "PHP"): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return formatExactCurrency(Math.round(safeAmount * 100), currency);
}
