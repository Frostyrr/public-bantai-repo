import { useState } from "react";

export interface SecurityTrendPoint {
  day: string;
  total: number;
  high_critical: number;
}

interface SecurityTrendLineChartProps {
  data: SecurityTrendPoint[];
  height?: number;
  emptyMessage?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

export default function SecurityTrendLineChart({
  data,
  height = 180,
  emptyMessage = "No security events recorded in this window.",
  primaryLabel = "Total",
  secondaryLabel = "High/Critical",
  primaryColor = "#10b981",
  secondaryColor = "#f43f5e",
}: SecurityTrendLineChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-subtle bg-elevated/20 text-xs text-muted"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const width = 640;
  const padLeft = 36;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(2, ...data.map((d) => d.total));
  const yTicks = [0, Math.ceil(maxVal / 2), maxVal];

  const coords = data.map((d, idx) => {
    const x =
      data.length === 1
        ? padLeft + plotW / 2
        : padLeft + (idx / (data.length - 1)) * plotW;
    const yTotal = padTop + plotH - (d.total / maxVal) * plotH;
    const yCrit = padTop + plotH - (d.high_critical / maxVal) * plotH;
    return { x, yTotal, yCrit, ...d };
  });

  const totalLine = coords.map((c) => `${c.x},${c.yTotal}`).join(" ");
  const critLine = coords.map((c) => `${c.x},${c.yCrit}`).join(" ");
  const areaPath =
    coords.length > 1
      ? `M ${coords[0].x},${padTop + plotH} ` +
        coords.map((c) => `L ${c.x},${c.yTotal}`).join(" ") +
        ` L ${coords[coords.length - 1].x},${padTop + plotH} Z`
      : "";

  const hovered = hoveredIdx !== null ? coords[hoveredIdx] : null;
  const labelStep = data.length > 10 ? Math.ceil(data.length / 7) : 1;

  return (
    <div className="relative w-full select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible"
        style={{ height }}
        role="img"
        aria-label="Security events daily trend line chart"
      >
        <defs>
          <linearGradient id="secTotalAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines & Y ticks */}
        {yTicks.map((tick) => {
          const y = padTop + plotH - (tick / maxVal) * plotH;
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="currentColor"
                className="text-subtle"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <text
                x={padLeft - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-muted text-[10px] font-mono tabular-nums"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Area under total line */}
        {areaPath && <path d={areaPath} fill="url(#secTotalAreaGrad)" />}

        {/* Total Events Line */}
        {coords.length > 1 && (
          <polyline
            fill="none"
            stroke={primaryColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={totalLine}
          />
        )}

        {/* High / Critical Events Line */}
        {coords.length > 1 && (
          <polyline
            fill="none"
            stroke={secondaryColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={critLine}
          />
        )}

        {/* Vertical hover guide */}
        {hovered && (
          <line
            x1={hovered.x}
            y1={padTop}
            x2={hovered.x}
            y2={padTop + plotH}
            stroke="currentColor"
            className="text-strong"
            strokeDasharray="2 2"
            strokeWidth={1}
          />
        )}

        {/* Data points + X-axis labels */}
        {coords.map((c, idx) => {
          const isHovered = hoveredIdx === idx;
          const showLabel = idx % labelStep === 0 || idx === coords.length - 1;
          return (
            <g
              key={c.day}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-pointer"
            >
              {/* Invisible wider hit target */}
              <rect
                x={c.x - 14}
                y={padTop}
                width={28}
                height={plotH}
                fill="transparent"
              />
              <circle
                cx={c.x}
                cy={c.yTotal}
                r={isHovered ? 4.5 : 3}
                fill={primaryColor}
                stroke="var(--color-surface, #111)"
                strokeWidth={1.5}
              />
              {c.high_critical > 0 && (
                <circle
                  cx={c.x}
                  cy={c.yCrit}
                  r={isHovered ? 4.5 : 3}
                  fill={secondaryColor}
                  stroke="var(--color-surface, #111)"
                  strokeWidth={1.5}
                />
              )}
              {showLabel && (
                <text
                  x={c.x}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-muted text-[10px] font-mono"
                >
                  {c.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-2 right-3 rounded-xl border border-subtle bg-elevated/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur-xs space-y-1"
          role="status"
        >
          <p className="font-mono text-primary font-medium">{hovered.day}</p>
          <p className="flex items-center gap-2 text-secondary font-mono tabular-nums">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: primaryColor }} />
            {primaryLabel}: <span className="text-primary">{hovered.total}</span>
          </p>
          <p className="flex items-center gap-2 text-secondary font-mono tabular-nums">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: secondaryColor }} />
            {secondaryLabel}: <span className="text-primary">{hovered.high_critical}</span>
          </p>
        </div>
      )}
    </div>
  );
}
