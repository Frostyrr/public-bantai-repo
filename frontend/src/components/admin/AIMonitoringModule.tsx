import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Clock,
  Cpu,
  Power,
  Search,
  Sliders,
  X,
} from "lucide-react";
import type {
  PlatformAIOverview,
  PlatformAIWorkspaceUsage,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import AnimatedNumber from "../ui/AnimatedNumber";

interface AIMonitoringModuleProps {
  overview: PlatformAIOverview | undefined;
  workspaces: PlatformAIWorkspaceUsage[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  days: 7 | 30;
  onChangeDays: (days: 7 | 30) => void;
  search: string;
  onChangeSearch: (q: string) => void;
  isSuperAdmin: boolean;
  isSavingQuota: boolean;
  onSaveQuota: (payload: {
    organizationId: string;
    organizationName: string;
    aiEnabled: boolean;
    dailyRequestLimit: number;
    monthlyTokenLimit: number;
    reason: string;
  }) => Promise<void>;
  activeTab?: "overview" | "workspaces" | "errors";
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

export default function AIMonitoringModule({
  overview,
  workspaces,
  isLoading,
  isError,
  error,
  onRetry,
  days,
  onChangeDays,
  search,
  onChangeSearch,
  isSuperAdmin,
  isSavingQuota,
  onSaveQuota,
  activeTab = "overview",
}: AIMonitoringModuleProps) {
  const [editingOrg, setEditingOrg] = useState<PlatformAIWorkspaceUsage | null>(null);
  const [errorSearch, setErrorSearch] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [dailyLimit, setDailyLimit] = useState("200");
  const [monthlyTokenLimit, setMonthlyTokenLimit] = useState("2000000");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const openQuotaModal = (ws: PlatformAIWorkspaceUsage) => {
    setEditingOrg(ws);
    setAiEnabled(ws.ai_enabled);
    setDailyLimit(String(ws.daily_request_limit));
    setMonthlyTokenLimit(String(ws.monthly_token_limit));
    setReason("");
    setFormError(null);
  };

  const handleConfirmQuota = async () => {
    if (!editingOrg) return;
    if (reason.trim().length < 3) {
      setFormError("Please document a reason (at least 3 characters).");
      return;
    }
    const daily = Math.max(0, Number.parseInt(dailyLimit, 10) || 0);
    const monthly = Math.max(0, Number.parseInt(monthlyTokenLimit, 10) || 0);
    setFormError(null);
    try {
      await onSaveQuota({
        organizationId: editingOrg.organization_id,
        organizationName: editingOrg.organization_name,
        aiEnabled,
        dailyRequestLimit: daily,
        monthlyTokenLimit: monthly,
        reason: reason.trim(),
      });
      setEditingOrg(null);
    } catch (err) {
      setFormError(formatErrorMessage(err));
    }
  };

  const summary = overview?.summary;
  const series = overview?.daily_series ?? [];
  const maxReq = Math.max(1, ...series.map((d) => d.requests));
  const totalRequests = summary?.total_requests ?? 0;
  const totalTokens = summary?.total_tokens ?? 0;
  const tokensUnavailable = totalRequests > 0 && totalTokens === 0;
  const estCostUsd =
    ((summary?.total_prompt_tokens ?? 0) / 1_000_000) * 0.15 +
    ((summary?.total_completion_tokens ?? 0) / 1_000_000) * 0.6;

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

      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-primary flex items-center gap-2">
            <Bot className="w-4 h-4 text-action" />
            Bani AI Telemetry & Quota Governance
          </h2>
          <p className="text-xs text-secondary">
            Non-content usage, token consumption, latency, and workspace-level AI limits. Exceeding AI limits never suspends a workspace.
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-subtle bg-surface p-0.5 self-start sm:self-auto">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChangeDays(d)}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                days === d ? "bg-elevated text-primary font-medium" : "text-secondary hover:text-primary"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="admin-kpi-card space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
              Total Requests ({days}d)
            </span>
            <span className="admin-kpi-icon text-emerald-400">
              <Activity className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
            <AnimatedNumber value={summary?.total_requests ?? 0} />
          </p>
          <p className="text-[11px] text-secondary">
            {summary?.active_workspaces ?? 0} workspaces · {summary?.active_users ?? 0} users
          </p>
        </div>

        <div className="admin-kpi-card space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
              Token Volume ({days}d)
            </span>
            <span className="admin-kpi-icon text-sky-400">
              <Cpu className="w-4 h-4" />
            </span>
          </div>
          <p
            className="text-2xl font-heading font-semibold text-primary tabular-nums"
            title={
              tokensUnavailable
                ? "Token metadata was not reported by the AI provider for these requests."
                : undefined
            }
          >
            {tokensUnavailable ? "Unavailable" : formatCompactNumber(totalTokens)}
          </p>
          <p className="text-[11px] text-secondary tabular-nums">
            {tokensUnavailable ? (
              "Provider token counts unavailable · Cost unavailable"
            ) : (
              <>
                In {formatCompactNumber(summary?.total_prompt_tokens ?? 0)} · Out{" "}
                {formatCompactNumber(summary?.total_completion_tokens ?? 0)} · Est. ${estCostUsd.toFixed(2)}
              </>
            )}
          </p>
        </div>

        <div className="admin-kpi-card space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
              Avg Latency
            </span>
            <span className="admin-kpi-icon text-secondary">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
            {summary?.avg_latency_ms ?? 0} ms
          </p>
          <p className="text-[11px] text-secondary tabular-nums">
            {summary?.total_tool_calls ?? 0} financial tool calls
          </p>
        </div>

        <div className="admin-kpi-card space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
              Errors & Throttles
            </span>
            <span className="admin-kpi-icon text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
            <AnimatedNumber value={(summary?.error_requests ?? 0) + (summary?.rate_limited_requests ?? 0)} />
          </p>
          <p className="text-[11px] text-secondary tabular-nums">
            {summary?.error_requests ?? 0} errors · {summary?.rate_limited_requests ?? 0} rate-limited ·{" "}
            {summary?.disabled_workspaces ?? 0} AI disabled
          </p>
        </div>
      </div>

      {/* Daily Requests Trend + Recent AI Errors */}
      {activeTab === "overview" && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 admin-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-medium text-primary">Daily Bani AI Requests</h3>
              <p className="text-[11px] text-secondary">Requests, errors, and quota throttles over the last {days} days</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Requests
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-400" /> Errors
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> Throttled
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="h-40 flex items-center justify-center text-xs text-secondary">Loading AI telemetry...</div>
          ) : series.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-xs text-secondary">No AI usage recorded in this window.</div>
          ) : (
            <div className="space-y-2">
              <div className="h-36 flex items-end gap-1 pt-2">
                {series.map((day) => {
                  const reqH = Math.max(2, Math.round((day.requests / maxReq) * 100));
                  const errH = day.errors > 0 ? Math.max(4, Math.round((day.errors / maxReq) * 100)) : 0;
                  const rlH = day.rate_limited > 0 ? Math.max(4, Math.round((day.rate_limited / maxReq) * 100)) : 0;
                  return (
                    <div
                      key={day.date}
                      title={`${day.date}: ${day.requests} req, ${day.tokens.toLocaleString()} tokens, ${day.errors} err, ${day.rate_limited} throttled`}
                      className="flex-1 h-full flex flex-col justify-end items-center gap-0.5 group"
                    >
                      <div className="w-full max-w-[18px] flex flex-col justify-end h-full">
                        {rlH > 0 && <div className="w-full bg-amber-400/80 rounded-t-sm" style={{ height: `${rlH}%` }} />}
                        {errH > 0 && <div className="w-full bg-rose-400/80" style={{ height: `${errH}%` }} />}
                        <div
                          className="w-full bg-emerald-500/70 group-hover:bg-emerald-400 transition-colors rounded-t-sm"
                          style={{ height: `${day.requests > 0 ? reqH : 2}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] font-mono text-muted">
                <span>{series[0]?.date}</span>
                <span>{series[series.length - 1]?.date}</span>
              </div>
            </div>
          )}
          {!isLoading && series.length > 0 && (
            <div className="pt-3 border-t border-subtle space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-primary">AI Usage Heatmap ({days}d)</span>
                <div className="flex items-center gap-1 text-[10px] font-mono text-muted">
                  <span>Less</span>
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-elevated/60 border border-subtle" />
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-950/80 border border-emerald-900/50" />
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-800/80" />
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-600/85" />
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-500" />
                  <span>More</span>
                </div>
              </div>
              <div className="grid grid-cols-7 sm:grid-cols-15 gap-1">
                {series.map((day) => {
                  const ratio = day.requests > 0 ? day.requests / maxReq : 0;
                  const cellTone =
                    day.requests === 0
                      ? "bg-elevated/60 border-subtle"
                      : ratio <= 0.25
                        ? "bg-emerald-950/80 border-emerald-900/60"
                        : ratio <= 0.5
                          ? "bg-emerald-800/80 border-emerald-700/50"
                          : ratio <= 0.75
                            ? "bg-emerald-600/85 border-emerald-500/50"
                            : "bg-emerald-500 border-emerald-400/60";
                  const dayEstCost =
                    day.tokens > 0 ? `$${((day.tokens / 1_000_000) * 0.3).toFixed(4)}` : day.requests > 0 ? "Unavailable" : "$0.00";
                  return (
                    <div
                      key={`hm-${day.date}`}
                      title={`${day.date} · ${day.requests} requests · ${
                        day.tokens > 0 ? `${day.tokens.toLocaleString()} tokens` : day.requests > 0 ? "Tokens unavailable" : "0 tokens"
                      } · Est. cost: ${dayEstCost}`}
                      className={`h-4 rounded-[3px] border transition-colors ${cellTone}`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Recent AI Errors & Throttles */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-xs font-medium text-primary">Recent AI Errors & Rate Limits</h3>
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {!overview?.recent_errors.length ? (
              <p className="text-xs text-secondary py-6 text-center">No recent AI errors or throttles.</p>
            ) : (
              overview.recent_errors.map((errItem) => (
                <div key={errItem.id} className="rounded-xl border border-subtle bg-elevated/40 p-2.5 text-[11px] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-primary truncate">
                      {errItem.organization_name || errItem.organization_id.slice(0, 8)}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${
                        errItem.status === "rate_limited"
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                      }`}
                    >
                      {errItem.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted font-mono text-[10px]">
                    <span>{errItem.error_code || errItem.model}</span>
                    <span>{new Date(errItem.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      )}

      {/* Workspace AI Usage & Quota Governance Table */}
      {activeTab === "workspaces" && (
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-medium text-primary">Workspace AI Usage & Quotas</h3>
            <p className="text-[11px] text-secondary">
              Monitor per-workspace consumption and configure non-destructive AI request/token limits.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => onChangeSearch(e.target.value)}
              placeholder="Filter workspaces..."
              className="w-full rounded-xl border border-subtle bg-surface pl-8 pr-3 py-1.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong"
            />
          </div>
        </div>

        <div className="admin-table-shell overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="admin-table-head text-muted uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3 font-medium">Workspace</th>
                <th className="px-4 py-3 font-medium">Bani Status</th>
                <th className="px-4 py-3 font-medium">Daily Requests</th>
                <th className="px-4 py-3 font-medium">Monthly Tokens</th>
                <th className="px-4 py-3 font-medium">{days}d Errors / Throttled</th>
                <th className="px-4 py-3 font-medium">Avg Latency</th>
                <th className="px-4 py-3 font-medium text-right">Governance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {!workspaces.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-secondary">
                    No matching workspaces found.
                  </td>
                </tr>
              ) : (
                workspaces.map((ws) => (
                  <tr key={ws.organization_id} className="hover:bg-hover-surface/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-primary">{ws.organization_name}</div>
                      <div className="text-[10px] font-mono text-muted">{ws.organization_id.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-3">
                      {ws.ai_enabled ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-mono text-emerald-400">
                          <Power className="w-3 h-3" /> Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-mono text-rose-400">
                          <Power className="w-3 h-3" /> Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-primary">
                      <div className="space-y-1 min-w-[110px]">
                        <div>
                          {ws.daily_requests_used} / {ws.daily_request_limit === 0 ? "∞" : ws.daily_request_limit}
                        </div>
                        {ws.daily_request_limit > 0 && (
                          <div className="h-1 rounded-full bg-elevated overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                ws.daily_requests_used >= ws.daily_request_limit
                                  ? "bg-rose-500"
                                  : ws.daily_requests_used / ws.daily_request_limit >= 0.8
                                    ? "bg-amber-400"
                                    : "bg-emerald-500"
                              }`}
                              style={{
                                width: `${Math.min(100, Math.round((ws.daily_requests_used / ws.daily_request_limit) * 100))}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-primary">
                      <div className="space-y-1 min-w-[120px]">
                        <div>
                          {formatCompactNumber(ws.monthly_tokens_used)} /{" "}
                          {ws.monthly_token_limit === 0 ? "∞" : formatCompactNumber(ws.monthly_token_limit)}
                        </div>
                        {ws.monthly_token_limit > 0 && (
                          <div className="h-1 rounded-full bg-elevated overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                ws.monthly_tokens_used >= ws.monthly_token_limit
                                  ? "bg-rose-500"
                                  : ws.monthly_tokens_used / ws.monthly_token_limit >= 0.8
                                    ? "bg-amber-400"
                                    : "bg-emerald-500"
                              }`}
                              style={{
                                width: `${Math.min(100, Math.round((ws.monthly_tokens_used / ws.monthly_token_limit) * 100))}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-secondary">
                      {ws.period_errors} err · {ws.period_rate_limited} throttled
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-secondary">{ws.avg_latency_ms} ms</td>
                    <td className="px-4 py-3 text-right">
                      {isSuperAdmin ? (
                        <button
                          type="button"
                          onClick={() => openQuotaModal(ws)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-elevated px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-hover-surface cursor-pointer"
                        >
                          <Sliders className="w-3 h-3" /> Configure
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted">Super Admin only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {/* Focused Errors & Throttles Tab */}
      {activeTab === "errors" && (
        <section className="admin-table-shell overflow-x-auto">
          <div className="px-5 py-4 border-b border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-medium text-primary">Recent AI Errors & Rate-Limited Events</h3>
              <p className="text-[11px] text-secondary">
                Non-content failure telemetry and workspace quota throttles over the last {days} days.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={errorSearch}
                onChange={(e) => setErrorSearch(e.target.value)}
                placeholder="Search workspace, status, or model..."
                aria-label="Search AI errors"
                className="w-full h-8 pl-8 pr-7 rounded-lg bg-[#09090b] border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent"
              />
              {errorSearch && (
                <button
                  type="button"
                  onClick={() => setErrorSearch("")}
                  aria-label="Clear AI error search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="admin-table-head text-muted uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Workspace</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Error / Reason</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium text-right">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {(() => {
                const needle = errorSearch.trim().toLowerCase();
                const filteredErrors = (overview?.recent_errors ?? []).filter((errItem) => {
                  if (!needle) return true;
                  return [
                    errItem.organization_name,
                    errItem.organization_id,
                    errItem.status,
                    errItem.error_code,
                    errItem.model,
                  ].some((val) => (val ?? "").toLowerCase().includes(needle));
                });
                if (!filteredErrors.length) {
                  return (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-secondary">
                        {needle
                          ? "No AI errors match your search."
                          : "No AI errors or rate-limit events recorded in this window."}
                      </td>
                    </tr>
                  );
                }
                return filteredErrors.map((errItem) => (
                  <tr key={errItem.id} className="hover:bg-hover-surface/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] text-secondary whitespace-nowrap">
                      {new Date(errItem.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-primary">
                      {errItem.organization_name || errItem.organization_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded border font-mono text-[10px] ${
                          errItem.status === "rate_limited"
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                        }`}
                      >
                        {errItem.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-secondary">
                      {errItem.error_code || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted">{errItem.model}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-right text-secondary">
                      {errItem.latency_ms} ms
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </section>
      )}

      {/* Quota Confirmation Modal */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md admin-card p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Workspace AI Governance</p>
                <h3 className="text-sm font-heading font-semibold text-primary">{editingOrg.organization_name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingOrg(null)}
                className="p-1 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="flex items-center justify-between rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5 cursor-pointer">
                <span className="font-medium text-primary">Enable Bani AI for this workspace</span>
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                  className="accent-emerald-500 w-4 h-4"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                    Daily Request Limit
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    className="w-full rounded-xl border border-subtle bg-elevated px-3 py-2 text-xs text-primary font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                    Monthly Token Limit
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={monthlyTokenLimit}
                    onChange={(e) => setMonthlyTokenLimit(e.target.value)}
                    className="w-full rounded-xl border border-subtle bg-elevated px-3 py-2 text-xs text-primary font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                  Audit Reason (Required)
                </label>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Document why this AI quota or toggle is being changed..."
                  className="w-full rounded-xl border border-subtle bg-elevated p-2.5 text-xs text-primary placeholder:text-muted"
                />
              </div>

              {formError && <p className="text-[11px] text-rose-400">{formError}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingOrg(null)}
                className="px-3 py-1.5 rounded-xl border border-subtle text-xs text-secondary hover:text-primary cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingQuota}
                onClick={handleConfirmQuota}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white disabled:opacity-50 cursor-pointer"
              >
                {isSavingQuota ? "Saving..." : "Confirm & Audit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
