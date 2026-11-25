import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Database,
  Lock,
  ShieldAlert,
  Zap,
} from "lucide-react";
import type {
  PlatformAdminOverview,
  PlatformSecurityOverview,
  SecurityCategory,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import AnimatedNumber from "../ui/AnimatedNumber";
import SecurityTrendLineChart from "./SecurityTrendLineChart";

interface SecurityTelemetryModuleProps {
  overview: PlatformSecurityOverview | undefined;
  health?: PlatformAdminOverview["health"];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  securityDays: 7 | 30;
  onChangeDays: (days: 7 | 30) => void;
  onInspectEvents: (category?: SecurityCategory) => void;
  onInspectIncidents: () => void;
  onEscalateBurst?: (alert: PlatformSecurityOverview["burst_alerts"][number]) => void;
}

const CATEGORY_LABELS: Array<{ key: SecurityCategory; label: string; colorClass: string }> = [
  { key: "auth", label: "Authentication", colorClass: "bg-blue-500" },
  { key: "access_control", label: "Access Control", colorClass: "bg-amber-500" },
  { key: "financial", label: "Financial Integrity", colorClass: "bg-emerald-500" },
  { key: "api_abuse", label: "API Abuse & 5xx", colorClass: "bg-rose-500" },
  { key: "data_protection", label: "Data Protection", colorClass: "bg-purple-500" },
];

export default function SecurityTelemetryModule({
  overview,
  health,
  isLoading,
  isError,
  error,
  onRetry,
  securityDays,
  onChangeDays,
  onInspectEvents,
  onInspectIncidents,
  onEscalateBurst,
}: SecurityTelemetryModuleProps) {
  const status403 = overview?.status_breakdown?.status_403 ?? overview?.denied_403 ?? 0;
  const status429 = overview?.status_breakdown?.status_429 ?? overview?.rate_limited_429 ?? 0;
  const status5xx = overview?.status_breakdown?.status_5xx ?? overview?.errors_5xx ?? 0;
  const totalStatus = status403 + status429 + status5xx;

  const categoryTotals = overview?.category_breakdown ?? {
    auth: 0,
    access_control: 0,
    financial: 0,
    api_abuse: 0,
    data_protection: 0,
  };
  const maxCategory = Math.max(1, ...Object.values(categoryTotals));

  return (
    <div className="space-y-6">
      {isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
          <span>{formatErrorMessage(error)}</span>
          <button
            type="button"
            onClick={onRetry}
            className="font-medium underline cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Telemetry Controls */}
      <div className="flex items-center justify-end">
        <div
          className="inline-flex rounded-xl border border-subtle bg-surface p-1 text-xs"
          role="group"
          aria-label="Telemetry time window"
        >
          {([7, 30] as const).map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => onChangeDays(days)}
              className={`rounded-lg px-3 py-1 font-medium transition-colors cursor-pointer ${
                securityDays === days
                  ? "bg-selected-surface text-primary shadow-xs"
                  : "text-secondary hover:text-primary"
              }`}
            >
              Last {days}d
            </button>
          ))}
        </div>
      </div>

      {/* 5 Telemetry Metric Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="admin-kpi-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted text-xs mb-2">
            <span className="font-mono uppercase tracking-wider text-[11px]">Denied (403)</span>
            <span className="admin-kpi-icon text-secondary">
              <Lock className="w-4 h-4 shrink-0" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-primary">
            {overview ? <AnimatedNumber value={overview.denied_403} /> : isLoading ? "…" : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-muted">Unauthorized access blocks</p>
        </div>

        <div className="admin-kpi-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted text-xs mb-2">
            <span className="font-mono uppercase tracking-wider text-[11px]">Rate-Limited (429)</span>
            <span className="admin-kpi-icon text-amber-400">
              <Zap className="w-4 h-4 shrink-0" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-amber-400">
            {overview ? <AnimatedNumber value={overview.rate_limited_429} /> : isLoading ? "…" : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-muted">API throttling triggers</p>
        </div>

        <div className="admin-kpi-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted text-xs mb-2">
            <span className="font-mono uppercase tracking-wider text-[11px]">Server Errors (5xx)</span>
            <span className="admin-kpi-icon text-rose-400">
              <Activity className="w-4 h-4 shrink-0" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-primary">
            {overview ? <AnimatedNumber value={overview.errors_5xx ?? 0} /> : isLoading ? "…" : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-muted">Authenticated backend 5xx</p>
        </div>

        <div className="admin-kpi-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted text-xs mb-2">
            <span className="font-mono uppercase tracking-wider text-[11px]">High / Critical</span>
            <span className="admin-kpi-icon text-rose-400">
              <ShieldAlert className="w-4 h-4 shrink-0" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-rose-400">
            {overview ? <AnimatedNumber value={overview.high_critical_events} /> : isLoading ? "…" : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-muted">Elevated severity events</p>
        </div>

        <button
          type="button"
          onClick={onInspectIncidents}
          className="admin-kpi-card flex flex-col justify-between text-left cursor-pointer"
        >
          <div className="flex items-center justify-between text-muted text-xs mb-2">
            <span className="font-mono uppercase tracking-wider text-[11px]">Open Incidents</span>
            <span className="admin-kpi-icon text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-primary">
            {overview ? <AnimatedNumber value={overview.open_incidents} /> : isLoading ? "…" : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-action inline-flex items-center gap-1">
            Triage queue <ArrowRight className="w-3 h-3" />
          </p>
        </button>
      </section>

      {/* Line Graph Card */}
      <section className="admin-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-primary">
              Security Event Volume Trend ({securityDays} Days)
            </h3>
            <p className="text-xs text-secondary">
              Daily total security events compared against high and critical severity detections.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 text-secondary font-mono">
              <span className="w-2.5 h-0.5 rounded-full bg-emerald-500" />
              Total Events
            </span>
            <span className="inline-flex items-center gap-1.5 text-secondary font-mono">
              <span className="w-2.5 h-0.5 rounded-full bg-rose-500" />
              High / Critical
            </span>
            <button
              type="button"
              onClick={() => onInspectEvents()}
              className="inline-flex items-center gap-1 text-xs font-medium text-action hover:underline cursor-pointer"
            >
              Inspect events
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <SecurityTrendLineChart
          data={overview?.daily_trend ?? []}
          height={220}
          emptyMessage={`No security events recorded in the last ${securityDays} days.`}
        />
      </section>

      {/* API Status Distribution + Category Breakdown */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 admin-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-primary">HTTP Error & Block Distribution</h3>
            <p className="text-xs text-secondary">
              Share of tracked 403, 429, and 5xx responses ({securityDays}d).
            </p>
          </div>

          <div className="h-3 w-full rounded-full bg-elevated overflow-hidden flex">
            {totalStatus > 0 && (
              <>
                <div
                  className="bg-amber-500 transition-all"
                  style={{ width: `${(status403 / totalStatus) * 100}%` }}
                  title={`403 Denied: ${status403}`}
                />
                <div
                  className="bg-yellow-400 transition-all"
                  style={{ width: `${(status429 / totalStatus) * 100}%` }}
                  title={`429 Rate-Limited: ${status429}`}
                />
                <div
                  className="bg-rose-500 transition-all"
                  style={{ width: `${(status5xx / totalStatus) * 100}%` }}
                  title={`5xx Errors: ${status5xx}`}
                />
              </>
            )}
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-primary">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                HTTP 403 (Access Denied)
              </span>
              <span className="font-mono tabular-nums text-primary">{status403}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-primary">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                HTTP 429 (Rate Limited)
              </span>
              <span className="font-mono tabular-nums text-primary">{status429}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-primary">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                HTTP 5xx (Server Errors)
              </span>
              <span className="font-mono tabular-nums text-primary">{status5xx}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 admin-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-primary">Domain Coverage & Category Breakdown</h3>
              <p className="text-xs text-secondary">
                Click a domain to filter Security Events by category.
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            {CATEGORY_LABELS.map((cat) => {
              const count = categoryTotals[cat.key] ?? 0;
              const pct = count > 0 ? Math.max(6, Math.round((count / maxCategory) * 100)) : 0;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => onInspectEvents(cat.key)}
                  className="w-full text-left rounded-xl border border-subtle bg-elevated/30 hover:border-strong px-3 py-2 transition-colors cursor-pointer space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-primary">{cat.label}</span>
                    <span className="font-mono tabular-nums text-secondary">{count}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-elevated overflow-hidden">
                    <div className={`h-full ${cat.colorClass} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Automated Burst Alerts + System Health */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 admin-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-primary">Automated Burst Alerts (15m Window)</h3>
              <p className="text-xs text-secondary">
                Actors triggering 5 or more 403/429 responses in the last 15 minutes.
              </p>
            </div>
          </div>

          {overview?.burst_alerts?.length ? (
            <div className="space-y-2">
              {overview.burst_alerts.map((alert, idx) => (
                <div
                  key={`${alert.actor_id ?? "anon"}-${alert.route}-${alert.http_status}-${idx}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2.5 text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-medium text-primary truncate">
                      {alert.actor_name || alert.actor_id || "Anonymous"} ·{" "}
                      <span className="font-mono text-rose-400">HTTP {alert.http_status}</span>
                    </p>
                    <p className="font-mono text-[11px] text-muted truncate">
                      {alert.event_count} events on {alert.route}
                    </p>
                  </div>
                  {onEscalateBurst && (
                    <button
                      type="button"
                      onClick={() => onEscalateBurst(alert)}
                      className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-surface hover:border-strong px-2.5 py-1 text-xs font-medium text-primary cursor-pointer shrink-0"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      Escalate
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted py-4 border-t border-subtle">
              No burst anomalies detected in the last 15 minutes.
            </p>
          )}
        </div>

        <div className="lg:col-span-5 admin-card p-5 space-y-3">
          <div>
            <h3 className="text-sm font-medium text-primary flex items-center gap-2">
              <Database className="w-4 h-4 text-action" />
              System & Database Health
            </h3>
            <p className="text-xs text-secondary">Live API runtime and PostgreSQL RPC ping.</p>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
              <span className="text-secondary">API Status</span>
              <span className="font-mono uppercase text-emerald-400">{health?.status ?? "unknown"}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
              <span className="text-secondary">Database Ping</span>
              <span className="font-mono text-primary">
                {health?.dbStatus ? `${health.dbStatus.toUpperCase()} (${health.dbLatencyMs ?? 0}ms)` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
              <span className="text-secondary">Uptime</span>
              <span className="font-mono text-primary">
                {health ? `${Math.floor(health.uptimeSeconds / 60)}m` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-subtle bg-elevated/40 px-3 py-2">
              <span className="text-secondary">Environment</span>
              <span className="font-mono text-primary">{health?.nodeEnv ?? "—"}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
