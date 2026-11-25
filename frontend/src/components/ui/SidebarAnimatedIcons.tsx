type IconProps = {
  className?: string;
};

const svgBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

/** Settings gear — rotates a full 360° on hover */
export function AnimatedSettingsIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} sb-anim sb-spin-360`}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Archive box — lid lifts open on hover */
export function AnimatedArchiveIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} overflow-visible`}>
      <rect width="20" height="5" x="2" y="3" rx="1" className="sb-anim sb-archive-lid" />
      <g className="sb-anim sb-archive-box">
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
        <path d="M10 12h4" />
      </g>
    </svg>
  );
}

/** Reports / BarChart3 — individual bars animate up and down */
export function AnimatedBarChartIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9" className="sb-anim sb-bar sb-bar-3" />
      <path d="M13 17V5" className="sb-anim sb-bar sb-bar-2" />
      <path d="M8 17v-3" className="sb-anim sb-bar sb-bar-1" />
    </svg>
  );
}

/** Overview / LayoutDashboard — grid tiles pulse sequentially */
export function AnimatedDashboardIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <rect width="7" height="9" x="3" y="3" rx="1" className="sb-anim sb-tile-1" />
      <rect width="7" height="5" x="14" y="3" rx="1" className="sb-anim sb-tile-2" />
      <rect width="7" height="9" x="14" y="12" rx="1" className="sb-anim sb-tile-3" />
      <rect width="7" height="5" x="3" y="16" rx="1" className="sb-anim sb-tile-4" />
    </svg>
  );
}

/** Receipt (Contributions / Collections) — receipt lines draw & subtle lift */
export function AnimatedReceiptIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path
        d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"
        className="sb-anim sb-lift"
      />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" className="sb-anim sb-draw" />
      <path d="M12 17.5v-11" className="sb-anim sb-lift" />
    </svg>
  );
}

/** Spaces & Projects / FolderKanban — folder lifts & kanban bars animate */
export function AnimatedFolderKanbanIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path
        d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"
        className="sb-anim sb-folder-tab"
      />
      <path d="M8 10v4" className="sb-anim sb-bar sb-bar-1" />
      <path d="M12 10v2" className="sb-anim sb-bar sb-bar-2" />
      <path d="M16 10v6" className="sb-anim sb-bar sb-bar-3" />
    </svg>
  );
}

/** Budgets / PieChart — pie slice pops out on hover */
export function AnimatedPieChartIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} overflow-visible`}>
      <path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" className="sb-anim sb-pie-slice" />
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    </svg>
  );
}

/** Expenses / CreditCard — card tilts and stripe slides */
export function AnimatedCreditCardIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} sb-anim sb-card-tilt`}>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" className="sb-anim sb-card-stripe" />
    </svg>
  );
}

/** Approvals / CheckSquare — checkmark draws on hover */
export function AnimatedCheckSquareIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344" />
      <path d="m9 11 3 3L22 4" className="sb-anim sb-draw" />
    </svg>
  );
}

/** Cash Advances / FileCheck — document checkmark draws on hover */
export function AnimatedFileCheckIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m9 15 2 2 4-4" className="sb-anim sb-draw" />
    </svg>
  );
}

/** Users / Directory — secondary user shifts into place */
export function AnimatedUsersIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <g className="sb-anim sb-user-primary">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </g>
      <g className="sb-anim sb-user-secondary">
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </g>
    </svg>
  );
}

/** User / Profile — subtle lift */
export function AnimatedUserIcon({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" className="sb-anim sb-lift" />
    </svg>
  );
}

/** ShieldCheck — checkmark inside shield draws on hover */
export function AnimatedShieldCheckIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" className="sb-anim sb-draw" />
    </svg>
  );
}

/** Shield — crisp lift & scale */
export function AnimatedShieldIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} sb-anim sb-lift`}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

/** ShieldAlert — alert nudge */
export function AnimatedShieldAlertIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} sb-anim sb-alert`}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

/** AlertTriangle — subtle alert shake */
export function AnimatedAlertTriangleIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} sb-anim sb-alert`}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** History / Audit Logs — rewinds counter-clockwise 360° */
export function AnimatedHistoryIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <g className="sb-anim sb-rewind">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </g>
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

/** Clock — clock hand ticks forward */
export function AnimatedClockIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" className="sb-anim sb-clock-hand" />
    </svg>
  );
}

/** Globe — smooth meridian rotation */
export function AnimatedGlobeIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} sb-anim sb-globe-spin`}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

/** Building2 — architectural lift */
export function AnimatedBuildingIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} sb-anim sb-lift`}>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  );
}

/** Landmark — ledger pillars lift */
export function AnimatedLandmarkIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <line x1="3" x2="21" y1="22" y2="22" />
      <g className="sb-anim sb-lift">
        <line x1="6" x2="6" y1="18" y2="11" />
        <line x1="10" x2="10" y1="18" y2="11" />
        <line x1="14" x2="14" y1="18" y2="11" />
        <line x1="18" x2="18" y1="18" y2="11" />
        <polygon points="12 2 20 7 4 7" />
      </g>
    </svg>
  );
}

/** Activity — ECG waveform draws on hover */
export function AnimatedActivityIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path
        d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
        className="sb-anim sb-draw"
      />
    </svg>
  );
}

/** Bot — head lifts & eyes blink */
export function AnimatedBotIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <g className="sb-anim sb-bot-head">
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2" />
        <path d="M20 14h2" />
        <path d="M15 13v2" className="sb-anim sb-bot-eye" />
        <path d="M9 13v2" className="sb-anim sb-bot-eye" />
      </g>
    </svg>
  );
}

/** Sliders — knobs slide along their tracks */
export function AnimatedSlidersIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="14" x2="14" y1="2" y2="6" className="sb-anim sb-slider-1" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="8" x2="8" y1="10" y2="14" className="sb-anim sb-slider-2" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="16" x2="16" y1="18" y2="22" className="sb-anim sb-slider-3" />
    </svg>
  );
}

/** Cpu — inner core pulses */
export function AnimatedCpuIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <rect width="16" height="16" x="4" y="4" rx="2" />
      <rect width="6" height="6" x="9" y="9" rx="1" className="sb-anim sb-tile-1" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </svg>
  );
}

/** Bell — rings gently on hover */
export function AnimatedBellIcon({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg {...svgBase} className={`${className} sb-anim sb-bell`}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** LogOut — arrow nudges right */
export function AnimatedLogOutIcon({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <g className="sb-anim sb-nudge-right">
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" x2="9" y1="12" y2="12" />
      </g>
    </svg>
  );
}

/** HandCoins — coin & hand for reimbursements */
export function AnimatedHandCoinsIcon({ className = "w-[18px] h-[18px]" }: IconProps) {
  return (
    <svg {...svgBase} className={className}>
      <g className="sb-anim sb-pop">
        <circle cx="16" cy="9" r="2.9" />
        <path d="M6 12a2.9 2.9 0 0 1 2.9-2.9h.2" />
      </g>
      <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" />
      <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
      <path d="m2 16 6 6" />
    </svg>
  );
}
