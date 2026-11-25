import { useState } from "react";

interface RoleSlice {
  key: string;
  label: string;
  count: number;
  color: string;
  dotClass: string;
}

interface RoleDistributionPieChartProps {
  superAdmins: number;
  admins: number;
  standardUsers: number;
}

export default function RoleDistributionPieChart({
  superAdmins,
  admins,
  standardUsers,
}: RoleDistributionPieChartProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const slices: RoleSlice[] = [
    {
      key: "super_admin",
      label: "Super Admin",
      count: superAdmins,
      color: "#f59e0b",
      dotClass: "bg-amber-500",
    },
    {
      key: "admin",
      label: "Admin",
      count: admins,
      color: "#3b82f6",
      dotClass: "bg-blue-500",
    },
    {
      key: "user",
      label: "Standard User",
      count: standardUsers,
      color: "#71717a",
      dotClass: "bg-zinc-500",
    },
  ];

  const total = superAdmins + admins + standardUsers;
  const size = 160;
  const center = size / 2;
  const radius = 56;
  const strokeWidth = 22;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;
  const segments = slices.map((slice) => {
    const ratio = total > 0 ? slice.count / total : 0;
    const length = ratio * circumference;
    const gap = total > 0 && slice.count > 0 && slices.filter((s) => s.count > 0).length > 1 ? 3 : 0;
    const dashArray = `${Math.max(0, length - gap)} ${circumference}`;
    const dashOffset = -cumulativeOffset;
    cumulativeOffset += length;
    return {
      ...slice,
      pct: total > 0 ? Math.round(ratio * 100) : 0,
      dashArray,
      dashOffset,
    };
  });

  const activeSlice = segments.find((s) => s.key === hoveredKey) ?? null;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full h-full -rotate-90"
          role="img"
          aria-label="Global role distribution pie chart"
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            className="text-elevated"
            strokeWidth={strokeWidth}
          />
          {total > 0 &&
            segments.map(
              (seg) =>
                seg.count > 0 && (
                  <circle
                    key={seg.key}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={hoveredKey === seg.key ? strokeWidth + 4 : strokeWidth}
                    strokeDasharray={seg.dashArray}
                    strokeDashoffset={seg.dashOffset}
                    strokeLinecap="butt"
                    className="transition-all duration-200 cursor-pointer"
                    opacity={hoveredKey && hoveredKey !== seg.key ? 0.45 : 1}
                    onMouseEnter={() => setHoveredKey(seg.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                  />
                )
            )}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-2">
          <span className="text-xl font-heading font-semibold tabular-nums text-primary leading-none">
            {activeSlice ? activeSlice.count : total}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted mt-1 truncate max-w-[84px]">
            {activeSlice ? `${activeSlice.pct}%` : "Total Users"}
          </span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-2.5">
        {segments.map((seg) => (
          <div
            key={seg.key}
            onMouseEnter={() => setHoveredKey(seg.key)}
            onMouseLeave={() => setHoveredKey(null)}
            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors cursor-default ${
              hoveredKey === seg.key
                ? "border-strong bg-elevated/80"
                : "border-subtle bg-elevated/40"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${seg.dotClass}`} />
              <span className="text-primary font-medium">{seg.label}</span>
            </div>
            <div className="flex items-center gap-2 font-mono tabular-nums">
              <span className="text-primary font-medium">{seg.count}</span>
              <span className="text-muted text-[11px] w-9 text-right">{seg.pct}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
