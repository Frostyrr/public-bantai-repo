interface AnimatedNumberProps {
  value: number;
  format?: (value: number) => string;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Displays a formatted numeric metric with a subtle, non-distracting vertical
 * settle-in transition on mount and whenever the formatted value changes.
 */
export default function AnimatedNumber({
  value,
  format = defaultFormat,
  className = "",
  title,
  ariaLabel,
}: AnimatedNumberProps) {
  const formatted = format(value);

  return (
    <span
      key={formatted}
      className={`tabular-nums inline-block animate-metric-settle ${className}`.trim()}
      title={title ?? formatted}
      aria-label={ariaLabel ?? formatted}
    >
      {formatted}
    </span>
  );
}
