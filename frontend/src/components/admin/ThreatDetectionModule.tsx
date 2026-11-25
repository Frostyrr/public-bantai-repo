import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Lock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import queryClient from "../../config/queryClient";
import {
  getPlatformSecurityHeatmap,
  getPlatformSessionTimeout,
  setPlatformSessionTimeout,
  type PlatformAccountLockout,
  type PlatformThreatOverview,
  type PlatformThreatSource,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import AnimatedNumber from "../ui/AnimatedNumber";
import { DatePicker } from "../ui/DatePicker";
import { Select } from "../ui/Select";
import SecurityTrendLineChart from "./SecurityTrendLineChart";
import DemoExemptionSettings from "./DemoExemptionSettings";
import SessionTimeoutBanner from "./SessionTimeoutBanner";
import SessionTimeoutModal from "./SessionTimeoutModal";

interface ThreatDetectionModuleProps {
  overview: PlatformThreatOverview | undefined;
  isSuperAdmin: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  days: 7 | 30;
  onChangeDays: (days: 7 | 30) => void;
  onReviewSource: (source: PlatformThreatSource) => void;
  onReviewAccount: (account: PlatformAccountLockout) => void;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function riskBadgeClass(risk: PlatformThreatSource["risk_level"]): string {
  switch (risk) {
    case "critical":
      return "bg-rose-500/15 text-rose-400 border-rose-500/30";
    case "high":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "medium":
      return "bg-yellow-500/10 text-yellow-300 border-yellow-500/25";
    default:
      return "bg-zinc-500/10 text-secondary border-subtle";
  }
}

function restrictionStatusMeta(status: PlatformThreatSource["restriction_status"]) {
  switch (status) {
    case "restricted":
      return { label: "Restricted", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" };
    case "monitoring":
      return { label: "Monitoring", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    default:
      return { label: "No restriction", cls: "bg-zinc-500/10 text-secondary border-subtle" };
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "monitor":
      return "Monitor";
    case "temp_ip_block":
      return "Temp IP Block";
    case "temp_account_lock":
      return "Temp Account Lock";
    case "revoke_sessions":
      return "Revoke Sessions";
    case "suspend_account":
      return "Suspend Account";
    case "remove_restriction":
      return "Remove Restriction";
    default:
      return action;
  }
}

export default function ThreatDetectionModule({
  overview,
  isSuperAdmin,
  isLoading,
  isError,
  error,
  onRetry,
  days,
  onChangeDays,
  onReviewSource,
  onReviewAccount,
}: ThreatDetectionModuleProps) {
  const [riskFilter, setRiskFilter] = useState<string>("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [heatmapTz, setHeatmapTz] = useState<"utc" | "manila" | "local">("utc");
  const [heatmapEventType, setHeatmapEventType] = useState<string>("");
  const [heatmapStartDate, setHeatmapStartDate] = useState<string>("");
  const [heatmapEndDate, setHeatmapEndDate] = useState<string>("");
  const [heatmapView, setHeatmapView] = useState<"grid" | "table">("grid");

  const sessionTimeoutKey = ["platform-admin", "session-timeout"];
  const sessionTimeoutQuery = useQuery({
    queryKey: sessionTimeoutKey,
    queryFn: getPlatformSessionTimeout,
    refetchOnWindowFocus: false,
  });
  const savedPolicy = sessionTimeoutQuery.data?.setting;
  const [isTimeoutModalOpen, setIsTimeoutModalOpen] = useState(false);

  const sessionTimeoutMutation = useMutation({
    mutationFn: setPlatformSessionTimeout,
    onSuccess: (response) => {
      queryClient.setQueryData(sessionTimeoutKey, response);
      setIsTimeoutModalOpen(false);
      toast.success("Session timeout policy saved.");
      void queryClient.invalidateQueries({ queryKey: ["platform-admin"] });
    },
    onError: (err) => toast.error(formatErrorMessage(err)),
  });

  const tzOffsetMinutes =
    heatmapTz === "manila"
      ? 480
      : heatmapTz === "local"
        ? -new Date().getTimezoneOffset()
        : 0;
  const tzLabel =
    heatmapTz === "manila"
      ? "UTC+8"
      : heatmapTz === "local"
        ? `UTC${tzOffsetMinutes >= 0 ? "+" : ""}${(tzOffsetMinutes / 60).toFixed(0)}`
        : "UTC";

  const useFilteredHeatmap =
    heatmapTz !== "utc" ||
    Boolean(heatmapEventType) ||
    Boolean(heatmapStartDate) ||
    Boolean(heatmapEndDate);

  const filteredHeatmapQuery = useQuery({
    queryKey: [
      "admin-security-heatmap",
      days,
      heatmapStartDate,
      heatmapEndDate,
      tzOffsetMinutes,
      heatmapEventType,
    ],
    queryFn: () =>
      getPlatformSecurityHeatmap({
        days,
        startDate: heatmapStartDate ? new Date(`${heatmapStartDate}T00:00:00Z`).toISOString() : undefined,
        endDate: heatmapEndDate ? new Date(`${heatmapEndDate}T23:59:59Z`).toISOString() : undefined,
        tzOffsetMinutes,
        eventType: heatmapEventType || undefined,
      }),
    enabled: useFilteredHeatmap,
  });

  const filteredSources = (overview?.suspicious_sources ?? []).filter((src) => {
    if (riskFilter && src.risk_level !== riskFilter) return false;
    if (sourceSearch.trim() && !src.source_ip.toLowerCase().includes(sourceSearch.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  // Build lookup map for 7x24 heatmap
  const activeHeatmapCells = useFilteredHeatmap
    ? (filteredHeatmapQuery.data?.heatmap ?? [])
    : (overview?.activity_heatmap ?? []);
  const heatMap = new Map<string, number>();
  let maxHeat = 1;
  for (const cell of activeHeatmapCells) {
    heatMap.set(`${cell.dow}-${cell.hour}`, cell.count);
    if (cell.count > maxHeat) maxHeat = cell.count;
  }

  const hourlyPeak = Math.max(1, ...(overview?.login_failures_hourly ?? []).map(point => point.failures));

  return (
    <div className="space-y-6">
      {isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
          <span>{formatErrorMessage(error)}</span>
          <button type="button" onClick={onRetry} className="font-medium underline cursor-pointer shrink-0">
            Retry
          </button>
        </div>
      )}

      {/* Time Window Control */}
      <div className="flex items-center justify-end">
        <div
          className="inline-flex rounded-xl border border-subtle bg-surface p-1 text-xs"
          role="group"
          aria-label="Threat detection time window"
        >
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChangeDays(d)}
              className={`rounded-lg px-3 py-1 font-medium transition-colors cursor-pointer ${
                days === d ? "bg-selected-surface text-primary shadow-xs" : "text-secondary hover:text-primary"
              }`}
            >
              Last {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Top KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="admin-kpi-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted text-xs mb-1.5">
            <span className="font-mono uppercase tracking-wider text-[11px]">Active Threats</span>
            <span className="admin-kpi-icon text-amber-400">
              <ShieldAlert className="w-4 h-4" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-primary">
            {overview ? <AnimatedNumber value={overview.active_threats} /> : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-muted">
            {overview?.restricted_ips ?? 0} IP block(s) active
          </p>
        </div>

        <div className="admin-kpi-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted text-xs mb-1.5">
            <span className="font-mono uppercase tracking-wider text-[11px]">Blocked Requests</span>
            <span className="admin-kpi-icon text-rose-400">
              <ShieldOff className="w-4 h-4" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-primary">
            {overview ? <AnimatedNumber value={overview.blocked_requests} /> : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-muted">
            401 / 403 / 429 in last {days}d
          </p>
        </div>

        <div className="admin-kpi-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted text-xs mb-1.5">
            <span className="font-mono uppercase tracking-wider text-[11px]">Restricted Accounts</span>
            <span className="admin-kpi-icon text-amber-400">
              <Lock className="w-4 h-4" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-primary">
            {overview ? <AnimatedNumber value={overview.restricted_accounts} /> : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-muted">
            Locked or suspended profiles
          </p>
        </div>

        <div className="admin-kpi-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted text-xs mb-1.5">
            <span className="font-mono uppercase tracking-wider text-[11px]">Unresolved Incidents</span>
            <span className="admin-kpi-icon text-rose-400">
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <p className="overview-kpi-value tabular-nums text-primary">
            {overview ? <AnimatedNumber value={overview.unresolved_incidents} /> : "—"}
          </p>
          <p className="mt-2 text-[11px] font-mono text-muted">
            Open & investigating alerts
          </p>
        </div>
      </section>

      {/* Automated Protection Policy Banner */}
      <section className="admin-card px-4 py-3 flex items-start gap-2.5 text-xs text-secondary">
        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-primary font-medium">Automated Server-Side Brute-Force Policies Active</p>
          <p className="text-[11px] text-secondary">
            Progressive account lockouts and temporary source IP cooldowns are enforced server-side. Google OAuth passwords are verified by Google; detection focuses on credential failures, invalid tokens, and API abuse.
          </p>
        </div>
      </section>

      {isSuperAdmin && <DemoExemptionSettings />}
      <SessionTimeoutBanner
        savedPolicy={savedPolicy}
        isPending={sessionTimeoutQuery.isPending}
        isError={sessionTimeoutQuery.isError}
        error={sessionTimeoutQuery.error}
        isSuperAdmin={isSuperAdmin}
        onRetry={() => void sessionTimeoutQuery.refetch()}
        onConfigure={() => setIsTimeoutModalOpen(true)}
      />

      {isSuperAdmin && savedPolicy && isTimeoutModalOpen && (
        <SessionTimeoutModal
          open={isTimeoutModalOpen}
          savedPolicy={savedPolicy}
          isSaving={sessionTimeoutMutation.isPending}
          onClose={() => setIsTimeoutModalOpen(false)}
          onSave={(payload) => sessionTimeoutMutation.mutate(payload)}
        />
      )}

      {overview && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className={`${overview.login_failures_hourly ? "lg:col-span-7" : "lg:col-span-12"} admin-card space-y-3 p-5`}>
              <div>
                <h3 className="text-sm font-medium text-primary">Monitoring Flags</h3>
                <p className="text-xs text-secondary">Automated behavioral patterns flagged in the selected window.</p>
              </div>
              {overview.monitor_flags?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-muted border-b border-subtle text-[11px] uppercase tracking-wider">
                        <th scope="col" className="py-2 pr-3 font-medium">Pattern</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Target</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Occurrence (PHT)</th>
                        <th scope="col" className="py-2 font-medium">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {overview.monitor_flags.map((flag) => {
                        const labels: Record<string, string> = {
                          ip_threshold: "Repeated login failures",
                          account_targeted: "Account targeted from multiple IPs",
                          otp_guessing: "Repeated OTP failures",
                          off_hours_login: "Off-hours login",
                        };
                        const detail = flag.pattern === "account_targeted" ? "distinct IPs" :
                          flag.pattern === "off_hours_login" ? "successful login" : "failed attempts";
                        return <tr key={JSON.stringify([flag.pattern, flag.target, flag.flag_day])}>
                          <td className="py-2 pr-3 text-primary">{labels[flag.pattern] ?? flag.pattern}</td>
                          <td className="py-2 pr-3 break-all font-mono text-secondary">{flag.target}</td>
                          <td className="py-2 pr-3 whitespace-nowrap text-secondary">
                            {flag.occurred_at ? new Date(flag.occurred_at).toLocaleString(undefined, { timeZone: "Asia/Manila" }) : flag.flag_day}
                          </td>
                          <td className="py-2 font-mono text-secondary">{flag.occurrences} {detail}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-secondary py-2">No monitoring flags in this period.</p>}
          </div>

          {overview.login_failures_hourly && (
            <div className="lg:col-span-5 admin-card p-5 flex flex-col justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-primary">Failed Logins (Last 24h)</h3>
                <p className="text-xs text-secondary">Hourly distribution of credential failures.</p>
              </div>
              <ul className="grid h-28 grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-1 rounded-xl border border-subtle bg-elevated/30 px-2.5 pt-3 pb-1">
                {overview.login_failures_hourly.map(({ start_at, failures }) => {
                  const start = new Date(start_at).toLocaleTimeString(undefined, {
                    timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit",
                  });
                  const label = `${start} PHT: ${failures} failed logins`;
                  return <li key={start_at} title={label} className="rounded-t bg-amber-400/80 hover:bg-amber-400 transition-colors"
                    style={{ height: failures ? `${Math.max(8, (failures / hourlyPeak) * 100)}%` : "2px" }}>
                    <span className="sr-only">{label}</span>
                  </li>;
                })}
              </ul>
              <div className="flex items-center justify-between text-[10px] font-mono text-muted">
                <span>24h ago</span>
                <span>Peak: {hourlyPeak}</span>
                <span>Now</span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Middle Row: Failed Auth Trend + Suspicious Activity Heatmap */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-6 admin-card p-5 flex flex-col justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-primary flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              Failed Auth & Blocked Traffic ({days}d)
            </h2>
            <p className="text-xs text-secondary">
              Daily unauthorized (401/auth) vs. rate-limited/blocked (429) events.
            </p>
          </div>
          <SecurityTrendLineChart
            data={(overview?.failed_auth_trend ?? []).map((pt) => ({
              day: pt.day,
              total: pt.failed_auth,
              high_critical: pt.blocked_requests,
            }))}
            height={175}
            primaryLabel="Failed Auth"
            secondaryLabel="Blocked (429)"
            primaryColor="#f59e0b"
            secondaryColor="#f43f5e"
            emptyMessage={`No failed authentication events in the last ${days} days.`}
          />
        </div>

        <div className="lg:col-span-6 admin-card p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-primary flex items-center gap-2">
                <Clock className="w-4 h-4 text-action" />
                Security Activity Heatmap ({tzLabel})
              </h2>
              <p className="text-xs text-secondary">
                Hourly concentration of failed auth & rate-limit events across days of the week.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHeatmapView((v) => (v === "grid" ? "table" : "grid"))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-elevated px-2.5 py-1 text-[11px] text-secondary hover:text-primary cursor-pointer self-start"
            >
              <Table2 className="w-3.5 h-3.5" />
              {heatmapView === "grid" ? "Table View" : "Heatmap View"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Select
              ariaLabel="Heatmap timezone"
              value={heatmapTz}
              onValueChange={(val) => setHeatmapTz(val as "utc" | "manila" | "local")}
              selectSize="sm"
              menuWidth="auto"
              options={[
                { value: "utc", label: "UTC" },
                { value: "manila", label: "Asia/Manila (+8)" },
                { value: "local", label: "Local TZ" },
              ]}
            />
            <Select
              ariaLabel="Heatmap event type"
              value={heatmapEventType}
              onValueChange={setHeatmapEventType}
              selectSize="sm"
              menuWidth="auto"
              options={[
                { value: "", label: "All Auth & Rate Events" },
                { value: "failed_login", label: "Failed Login" },
                { value: "auth_failure_edge", label: "Edge Auth Failure (401/403)" },
                { value: "rate_limited", label: "Rate Limited (429)" },
                { value: "account_locked", label: "Account Locked" },
              ]}
            />
            <DatePicker
              value={heatmapStartDate}
              onChange={setHeatmapStartDate}
              placeholder="Start date"
              size="sm"
              className="w-36"
            />
            <DatePicker
              value={heatmapEndDate}
              onChange={setHeatmapEndDate}
              placeholder="End date"
              size="sm"
              className="w-36"
              align="right"
            />
          </div>

          {heatmapView === "grid" ? (
            <div className="space-y-1.5 overflow-x-auto">
              {DOW_LABELS.map((label, dow) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-7 text-[10px] font-mono text-muted shrink-0">{label}</span>
                  <div className="grid grid-cols-24 gap-1 flex-1 min-w-[280px]">
                    {Array.from({ length: 24 }, (_, hour) => {
                      const count = heatMap.get(`${dow}-${hour}`) ?? 0;
                      const ratio = count / maxHeat;
                      const bg =
                        count === 0
                          ? "bg-elevated/60"
                          : ratio > 0.66
                            ? "bg-rose-500/80"
                            : ratio > 0.33
                              ? "bg-amber-500/70"
                              : "bg-emerald-500/50";
                      return (
                        <div
                          key={hour}
                          title={`${label} ${String(hour).padStart(2, "0")}:00 ${tzLabel} — ${count} event(s)`}
                          className={`h-3.5 rounded-[3px] ${bg} transition-colors`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between text-[10px] font-mono text-muted pl-9 pt-1">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>23:00</span>
              </div>
              <div className="flex items-center justify-end gap-1.5 pt-1 text-[10px] font-mono text-muted">
                <span>Less</span>
                <span className="w-3 h-2.5 rounded-[2px] bg-elevated/60 border border-subtle" />
                <span className="w-3 h-2.5 rounded-[2px] bg-emerald-500/50" />
                <span className="w-3 h-2.5 rounded-[2px] bg-amber-500/70" />
                <span className="w-3 h-2.5 rounded-[2px] bg-rose-500/80" />
                <span>More</span>
              </div>
            </div>
          ) : (
            <div className="max-h-44 overflow-y-auto rounded-xl border border-subtle">
              <table className="w-full text-left text-[11px]">
                <thead className="border-b border-subtle text-muted uppercase font-mono">
                  <tr>
                    <th className="px-3 py-1.5">Day</th>
                    <th className="px-3 py-1.5">Hour ({tzLabel})</th>
                    <th className="px-3 py-1.5 text-right">Events</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle font-mono">
                  {activeHeatmapCells.filter((c) => c.count > 0).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-secondary">
                        No non-zero cells in this filter window.
                      </td>
                    </tr>
                  ) : (
                    activeHeatmapCells
                      .filter((c) => c.count > 0)
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 40)
                      .map((cell) => (
                        <tr key={`${cell.dow}-${cell.hour}`}>
                          <td className="px-3 py-1.5 text-primary">{DOW_LABELS[cell.dow] ?? cell.dow}</td>
                          <td className="px-3 py-1.5 text-secondary">{String(cell.hour).padStart(2, "0")}:00</td>
                          <td className="px-3 py-1.5 text-right text-amber-400">{cell.count}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Filterable Suspicious IP Activity Table */}
      <section className="admin-table-shell overflow-hidden">
        <div className="px-5 py-4 border-b border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-primary">Suspicious Sources & IP Monitoring</h2>
            <p className="text-xs text-secondary">
              Click Review on any source to inspect evidence and apply enforcement actions.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <input
              type="search"
              value={sourceSearch}
              onChange={(e) => setSourceSearch(e.target.value)}
              placeholder="Filter IP..."
              className="rounded-xl border border-subtle bg-elevated/50 px-3 py-1.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong w-40"
            />
            <Select
              value={riskFilter}
              onValueChange={setRiskFilter}
              ariaLabel="Filter by risk level"
              selectSize="sm"
              menuWidth="auto"
              align="right"
              options={[
                { value: "", label: "All Risk Levels" },
                { value: "critical", label: "Critical" },
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
              ]}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3 font-medium">Source IP</th>
                <th className="px-4 py-3 font-medium">Attempts</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Detected</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                    Analyzing threat telemetry...
                  </td>
                </tr>
              ) : filteredSources.length ? (
                filteredSources.map((src) => {
                  const st = restrictionStatusMeta(src.restriction_status);
                  return (
                    <tr key={src.source_ip} className="hover:bg-hover-surface/40">
                      <td className="px-4 py-3 font-mono text-primary">{src.source_ip}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-primary">{src.attempts}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono capitalize ${riskBadgeClass(src.risk_level)}`}>
                          {src.risk_level} ({src.risk_score})
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-secondary whitespace-nowrap">
                        {new Date(src.last_detected).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onReviewSource(src)}
                          className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-elevated/60 hover:border-strong px-2.5 py-1 text-[11px] font-medium text-primary cursor-pointer"
                        >
                          Review
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                    No suspicious IP sources detected in the last {days} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Account Lockouts & Enforcement History */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        <div className="admin-table-shell overflow-hidden">
          <div className="px-5 py-4 border-b border-subtle">
            <h2 className="text-sm font-medium text-primary">Account Lockouts & Session Revocations</h2>
            <p className="text-xs text-secondary">
              Accounts with active temporary locks, suspensions, or forced session revocations.
            </p>
          </div>
          <div className="divide-y divide-subtle">
            {overview?.account_lockouts.length ? (
              overview.account_lockouts.map((acc) => (
                <div key={acc.user_id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-primary truncate">
                      {acc.display_name || acc.email || acc.user_id}
                    </p>
                    <p className="text-[11px] text-secondary truncate">
                      {acc.suspended_at
                        ? `Suspended: ${acc.suspension_reason || "Administrative restriction"}`
                        : acc.locked_until
                          ? `Locked until ${new Date(acc.locked_until).toLocaleString()}`
                          : acc.sessions_revoked_at
                            ? `Sessions revoked ${new Date(acc.sessions_revoked_at).toLocaleString()}`
                            : "Restricted"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReviewAccount(acc)}
                    className="rounded-lg border border-subtle bg-elevated/60 hover:border-strong px-2.5 py-1 text-[11px] font-medium text-primary cursor-pointer shrink-0"
                  >
                    Manage
                  </button>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-center text-xs text-secondary">
                No active account lockouts or session revocations.
              </p>
            )}
          </div>
        </div>

        <div className="admin-table-shell overflow-hidden">
          <div className="px-5 py-4 border-b border-subtle">
            <h2 className="text-sm font-medium text-primary">Enforcement Audit History</h2>
            <p className="text-xs text-secondary">
              Immutable timeline of automated and administrative enforcement actions.
            </p>
          </div>
          <div className="divide-y divide-subtle max-h-[320px] overflow-y-auto">
            {overview?.enforcement_history.length ? (
              overview.enforcement_history.map((item) => (
                <div key={item.id} className="px-5 py-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-primary">
                      {actionLabel(item.action_type)} ·{" "}
                      <span className="font-mono text-secondary">
                        {item.target_ip || item.target_name || item.target_user_id}
                      </span>
                    </span>
                    <span className="text-[11px] font-mono text-muted shrink-0">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-secondary">{item.reason}</p>
                  <p className="text-[10px] font-mono text-muted">
                    By {item.auto_triggered ? "Automated Policy" : item.actor_name || "Platform Admin"}
                    {item.expires_at ? ` · Expires ${new Date(item.expires_at).toLocaleString()}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-center text-xs text-secondary">
                No enforcement actions recorded yet.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
