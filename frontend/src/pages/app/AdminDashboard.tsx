import API from "../../config/apiClient";
import { startTransition, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AnimatedActivityIcon,
  AnimatedAlertTriangleIcon,
  AnimatedBotIcon,
  AnimatedBuildingIcon,
  AnimatedClockIcon,
  AnimatedCpuIcon,
  AnimatedDashboardIcon,
  AnimatedGlobeIcon,
  AnimatedHistoryIcon,
  AnimatedLandmarkIcon,
  AnimatedShieldAlertIcon,
  AnimatedShieldCheckIcon,
  AnimatedShieldIcon,
  AnimatedSlidersIcon,
  AnimatedUsersIcon,
} from "../../components/ui/SidebarAnimatedIcons";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Code2,
  Download,
  Eye,
  Globe,
  Info,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Plus,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import useAuth from "../../hooks/useAuth";
import queryClient from "../../config/queryClient";
import {
  createPlatformSecurityIncident,
  enforcePlatformAction,
  exportPlatformAdminAuditLogsCsv,
  exportPlatformSecurityEventsCsv,
  getPlatformAdminOverview,
  getPlatformAIOverview,
  getPlatformAttentionSummary,
  getPlatformFinancialCompliance,
  getPlatformFinancialOverview,
  getPlatformOrg360Extended,
  getPlatformRealtimeVisitors,
  getPlatformSecurityOverview,
  getPlatformThreatOverview,
  getPlatformUserDetails,
  getPlatformWorkspace360,
  listPlatformAdminAuditLogs,
  listPlatformAdminOrganizations,
  listPlatformAdminUsers,
  listPlatformAIWorkspaces,
  listPlatformFinancialAnomalies,
  listPlatformSecurityEvents,
  listPlatformSecurityIncidents,
  setPlatformAdminOrgSuspension,
  setPlatformAdminUserRole,
  setPlatformAdminUserSuspension,
  setPlatformWorkspaceAIQuota,
  updatePlatformSecurityIncident,
  type EnforcementActionType,
  type IncidentStatus,
  type PlatformAccountLockout,
  type PlatformAdminAuditLog,
  type PlatformAdminOrganization,
  type PlatformAdminUser,
  type PlatformRole,
  type PlatformSecurityEvent,
  type PlatformSecurityIncident,
  type PlatformThreatSource,
  type SecurityCategory,
  type SecuritySeverity,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import { navigateWithTransition } from "../../utils/navTransition";
import {
  AUDIT_SIGNIFICANCE_META,
  formatAuditActionLabel,
  formatAuditChangeSummary,
  getAuditActionSignificance,
} from "../../utils/auditActionLabels";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import BantaiLogo from "../../components/ui/BantaiLogo";
import AnimatedNumber from "../../components/ui/AnimatedNumber";
import CompactAmount from "../../components/ui/CompactAmount";
import { DatePicker } from "../../components/ui/DatePicker";
import { Modal } from "../../components/ui/Modal";
import Pagination from "../../components/ui/Pagination";
import { Select } from "../../components/ui/Select";
import NotificationBell from "../../components/notifications/NotificationBell";
import UserMenu from "../../components/user/userMenu";
import SecurityTrendLineChart from "../../components/admin/SecurityTrendLineChart";
import SecurityTelemetryModule from "../../components/admin/SecurityTelemetryModule";
import ThreatDetectionModule from "../../components/admin/ThreatDetectionModule";
import FinancialOversightModule from "../../components/admin/FinancialOversightModule";
import AIMonitoringModule from "../../components/admin/AIMonitoringModule";

type AdminSection =
  | "overview"
  | "visitors"
  | "organizations"
  | "users"
  | "security"
  | "threats"
  | "security-events"
  | "operational"
  | "incidents"
  | "financial"
  | "financial-compliance"
  | "financial-anomalies"
  | "ai"
  | "ai-workspaces"
  | "ai-errors"
  | "audit";
type OrgDrawerTab = "overview" | "activity" | "ai" | "financial" | "security" | "audit";

function actorRoleBadgeStyle(role?: PlatformRole | null): { label: string; cls: string; dot: string } {
  switch (role) {
    case "super_admin":
      return {
        label: "Super Admin",
        cls: "bg-rose-500/15 text-rose-300 border-rose-500/30",
        dot: "bg-rose-400",
      };
    case "admin":
      return {
        label: "Admin",
        cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
        dot: "bg-amber-400",
      };
    case "user":
      return {
        label: "User",
        cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        dot: "bg-emerald-400",
      };
    default:
      return {
        label: "System",
        cls: "bg-zinc-500/10 text-secondary border-subtle",
        dot: "bg-zinc-400",
      };
  }
}

function renderAuditActorBadge(
  actorName: string | null,
  actorRole: PlatformRole | null | undefined,
  actorId: string | null,
  mode: "normal" | "developer"
) {
  const meta = actorRoleBadgeStyle(actorRole);
  const displayName = actorName || (actorId ? "Unnamed User" : "System");
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          <span>{displayName}</span>
          <span className="opacity-75 font-mono text-[10px]">· {meta.label}</span>
        </span>
      </div>
      {mode === "developer" && actorId && (
        <div className="font-mono text-[11px] text-muted">{actorId}</div>
      )}
    </div>
  );
}

function toIsoBoundary(dateStr: string, endOfDay: boolean): string | undefined {
  if (!dateStr) return undefined;
  return `${dateStr}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
}

function severityBadgeClass(severity: SecuritySeverity): string {
  switch (severity) {
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

function incidentStatusBadgeClass(status: IncidentStatus): string {
  switch (status) {
    case "open":
      return "bg-rose-500/15 text-rose-400 border-rose-500/30";
    case "investigating":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "resolved":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "false_positive":
      return "bg-zinc-500/15 text-secondary border-subtle";
  }
}

function EventSignificanceLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-secondary"
      aria-label="Event significance legend"
    >
      <span className="font-mono uppercase tracking-wider text-muted text-[10px]">
        Significance:
      </span>
      {(["critical", "high", "medium", "low"] as const).map((level) => {
        const meta = AUDIT_SIGNIFICANCE_META[level];
        return (
          <div key={level} className="relative group">
            <button
              type="button"
              tabIndex={0}
              aria-describedby={`legend-tip-${level}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-subtle bg-elevated/40 px-2 py-0.5 hover:border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-strong transition-colors cursor-default"
            >
              <span className={`w-2 h-2 rounded-full ${meta.dotClass}`} />
              <span className="text-primary font-medium">{meta.label}</span>
            </button>
            <div
              id={`legend-tip-${level}`}
              role="tooltip"
              className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity duration-150 absolute left-0 bottom-full mb-1.5 z-30 w-max max-w-[230px] rounded-lg border border-subtle bg-elevated/95 px-2.5 py-1.5 text-[11px] text-primary shadow-lg backdrop-blur-xs"
            >
              {meta.description}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderAuditEventBadge(action: string, mode: "normal" | "developer") {
  const sig = getAuditActionSignificance(action);
  const meta = AUDIT_SIGNIFICANCE_META[sig];
  if (mode === "developer") {
    return (
      <code
        className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] ${meta.badgeClass}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotClass}`} />
        {action}
      </code>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotClass}`} />
      {formatAuditActionLabel(action)}
    </span>
  );
}

const DEFAULT_RIGHT_PANEL_WIDTH = 420;
const MIN_RIGHT_PANEL_WIDTH = 320;
const MAX_RIGHT_PANEL_WIDTH = 760;
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "bantai_admin_right_panel_width";

export default function AdminDashboard() {
  const { user } = useAuth();
  const reportedDashboardUser = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id) {
      reportedDashboardUser.current = null;
      return;
    }
    if (reportedDashboardUser.current === user.id) return;
    reportedDashboardUser.current = user.id;
    void API.post("/admin/security/dashboard-entry").catch(() => undefined);
  }, [user?.id]);
  const navigate = useNavigate();
  const location = useLocation();
  const requestedSection = new URLSearchParams(location.search).get("section");
  const inboxSection = requestedSection === "incidents" || requestedSection === "threats" ? requestedSection : null;
  const [sectionState, setSectionState] = useState<{ key: string; value: AdminSection }>({
    key: location.key,
    value: inboxSection ?? "overview",
  });
  const section: AdminSection =
    inboxSection && sectionState.key !== location.key ? inboxSection : sectionState.value;
  const setSection = (next: AdminSection | ((prev: AdminSection) => AdminSection)) => {
    setSectionState((prev) => {
      const current = inboxSection && prev.key !== location.key ? inboxSection : prev.value;
      const value = typeof next === "function" ? next(current) : next;
      return { key: location.key, value };
    });
  };
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("bantai_admin_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= MIN_RIGHT_PANEL_WIDTH && saved <= MAX_RIGHT_PANEL_WIDTH) {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_RIGHT_PANEL_WIDTH;
  });
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false);

  const resetRightPanelWidth = () => {
    setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH);
    try {
      localStorage.removeItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    if (!isResizingRightPanel) return;

    const handlePointerMove = (e: PointerEvent) => {
      const maxAllowed = Math.min(MAX_RIGHT_PANEL_WIDTH, Math.floor(window.innerWidth * 0.65));
      const nextWidth = Math.max(
        MIN_RIGHT_PANEL_WIDTH,
        Math.min(maxAllowed, Math.round(window.innerWidth - e.clientX))
      );
      setRightPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setIsResizingRightPanel(false);
    };

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizingRightPanel]);

  useEffect(() => {
    if (isResizingRightPanel) return;
    try {
      if (rightPanelWidth === DEFAULT_RIGHT_PANEL_WIDTH) {
        localStorage.removeItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
      } else {
        localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
      }
    } catch {
      // ignore storage errors
    }
  }, [rightPanelWidth, isResizingRightPanel]);

  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | PlatformRole>("");
  const [orgSearch, setOrgSearch] = useState("");

  // Overview security telemetry window
  const [securityDays, setSecurityDays] = useState<7 | 30>(7);
  const [orgDrawerTab, setOrgDrawerTab] = useState<OrgDrawerTab>("overview");

  // Audit filters & pagination
  const [auditFilter, setAuditFilter] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(25);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingEventsCsv, setIsExportingEventsCsv] = useState(false);

  const [eventCategory, setEventCategory] = useState<"" | SecurityCategory>("");
  const [eventSeverity, setEventSeverity] = useState<"" | SecuritySeverity>("");
  const [eventSearch, setEventSearch] = useState("");
  const [eventPage, setEventPage] = useState(1);
  const [eventPageSize, setEventPageSize] = useState(25);

  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentStatus, setIncidentStatus] = useState<"" | IncidentStatus>("");
  const [incidentSeverity, setIncidentSeverity] = useState<"" | SecuritySeverity>("");
  const [incidentPage, setIncidentPage] = useState(1);
  const [incidentPageSize, setIncidentPageSize] = useState(25);

  // Right-side docked panel state (audit log OR security event OR incident OR new incident OR user/org)
  const [selectedAuditLog, setSelectedAuditLog] = useState<PlatformAdminAuditLog | null>(null);
  const [selectedSecurityEvent, setSelectedSecurityEvent] = useState<PlatformSecurityEvent | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<PlatformSecurityIncident | null>(null);
  const [selectedUser, setSelectedUser] = useState<PlatformAdminUser | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<PlatformAdminOrganization | null>(null);
  const [selectedThreatSource, setSelectedThreatSource] = useState<PlatformThreatSource | null>(null);
  const [selectedThreatAccount, setSelectedThreatAccount] = useState<PlatformAccountLockout | null>(null);
  const [enforceActionType, setEnforceActionType] = useState<EnforcementActionType>("monitor");
  const [enforceDurationMinutes, setEnforceDurationMinutes] = useState<number>(60);
  const [enforceReason, setEnforceReason] = useState("");
  const [suspensionReason, setSuspensionReason] = useState("");
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: PlatformAdminUser;
    nextRole: PlatformRole;
  } | null>(null);
  const [pendingAdminAction, setPendingAdminAction] = useState<
    | {
        kind: "user_suspension";
        target: PlatformAdminUser;
        suspended: boolean;
        reason: string;
      }
    | {
        kind: "org_suspension";
        target: PlatformAdminOrganization;
        suspended: boolean;
        reason: string;
      }
    | {
        kind: "incident_status";
        incident: PlatformSecurityIncident;
        nextStatus: IncidentStatus;
        resolutionNotes?: string;
      }
    | {
        kind: "enforce_action";
        actionType: EnforcementActionType;
        reason: string;
        targetIp?: string;
        targetUserId?: string;
        targetLabel: string;
        durationMinutes?: number;
      }
    | null
  >(null);
  const [isCreatingIncident, setIsCreatingIncident] = useState(false);

  // Incident form / triage state
  const [newIncidentTitle, setNewIncidentTitle] = useState("");
  const [newIncidentCategory, setNewIncidentCategory] = useState<SecurityCategory>("api_abuse");
  const [newIncidentSeverity, setNewIncidentSeverity] = useState<SecuritySeverity>("high");
  const [newIncidentNotes, setNewIncidentNotes] = useState("");
  const [newIncidentEventIds, setNewIncidentEventIds] = useState<number[]>([]);
  const [newIncidentOrgId, setNewIncidentOrgId] = useState<string | undefined>(undefined);
  const [triageNotes, setTriageNotes] = useState("");

  const [auditViewMode, setAuditViewMode] = useState<"normal" | "developer">(() => {
    try {
      return localStorage.getItem("bantai_admin_audit_view") === "developer" ? "developer" : "normal";
    } catch {
      return "normal";
    }
  });

  const hasRightPanel = Boolean(
    selectedAuditLog ||
      selectedSecurityEvent ||
      selectedIncident ||
      selectedUser ||
      selectedOrg ||
      selectedThreatSource ||
      selectedThreatAccount ||
      isCreatingIncident
  );

  const closeRightPanel = () => {
    setSelectedAuditLog(null);
    setSelectedSecurityEvent(null);
    setSelectedIncident(null);
    setSelectedUser(null);
    setSelectedOrg(null);
    setSelectedThreatSource(null);
    setSelectedThreatAccount(null);
    setEnforceReason("");
    setSuspensionReason("");
    setIsCreatingIncident(false);
  };

  const openThreatSourcePanel = (src: PlatformThreatSource) => {
    closeRightPanel();
    setEnforceActionType(src.restriction_status === "restricted" ? "remove_restriction" : "temp_ip_block");
    setEnforceDurationMinutes(60);
    setEnforceReason("");
    setSelectedThreatSource(src);
  };

  const openThreatAccountPanel = (acc: PlatformAccountLockout) => {
    closeRightPanel();
    setEnforceActionType(
      acc.suspended_at || acc.locked_until ? "remove_restriction" : "temp_account_lock"
    );
    setEnforceDurationMinutes(60);
    setEnforceReason("");
    setSelectedThreatAccount(acc);
  };

  const openUserPanel = (u: PlatformAdminUser) => {
    closeRightPanel();
    setSuspensionReason(u.suspension_reason ?? "");
    setSelectedUser(u);
  };

  const openOrgPanel = (org: PlatformAdminOrganization) => {
    closeRightPanel();
    setSuspensionReason(org.suspension_reason ?? "");
    setOrgDrawerTab("overview");
    setSelectedOrg(org);
  };

  const openAuditLogPanel = (log: PlatformAdminAuditLog) => {
    setSelectedSecurityEvent(null);
    setSelectedIncident(null);
    setIsCreatingIncident(false);
    setSelectedAuditLog(log);
  };

  const openSecurityEventPanel = (ev: PlatformSecurityEvent) => {
    setSelectedAuditLog(null);
    setSelectedIncident(null);
    setIsCreatingIncident(false);
    setSelectedSecurityEvent(ev);
  };

  const openIncidentPanel = (inc: PlatformSecurityIncident) => {
    setSelectedAuditLog(null);
    setSelectedSecurityEvent(null);
    setIsCreatingIncident(false);
    setTriageNotes(inc.resolution_notes ?? "");
    setSelectedIncident(inc);
  };

  const openNewIncidentForm = (fromEvent?: PlatformSecurityEvent) => {
    setSelectedAuditLog(null);
    setSelectedSecurityEvent(null);
    setSelectedIncident(null);
    setNewIncidentTitle(
      fromEvent ? `${fromEvent.action} (${fromEvent.http_status ?? fromEvent.outcome})` : ""
    );
    setNewIncidentCategory(fromEvent?.category ?? "api_abuse");
    setNewIncidentSeverity(fromEvent?.severity ?? "high");
    setNewIncidentNotes(
      fromEvent?.route
        ? `Triggered from security event #${fromEvent.id} on ${fromEvent.route}${fromEvent.request_id ? ` (req: ${fromEvent.request_id})` : ""}`
        : ""
    );
    setNewIncidentEventIds(fromEvent ? [fromEvent.id] : []);
    setNewIncidentOrgId(fromEvent?.organization_id ?? undefined);
    setIsCreatingIncident(true);
  };

  useEffect(() => {
    if (!hasRightPanel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRightPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasRightPanel]);

  const toggleAuditViewMode = (mode: "normal" | "developer") => {
    setAuditViewMode(mode);
    try {
      localStorage.setItem("bantai_admin_audit_view", mode);
    } catch {
      // ignore storage errors
    }
  };

  const isAdmin = user?.platformRole === "admin" || user?.platformRole === "super_admin";
  const isSuperAdmin = user?.platformRole === "super_admin";

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("bantai_admin_sidebar_collapsed", String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const overviewQuery = useQuery({
    queryKey: ["platform-admin", "overview"],
    queryFn: getPlatformAdminOverview,
    enabled: isAdmin,
  });

  const usersQuery = useQuery({
    queryKey: ["platform-admin", "users", userSearch, roleFilter],
    queryFn: () =>
      listPlatformAdminUsers({
        q: userSearch.trim() || undefined,
        role: roleFilter || undefined,
        limit: 50,
      }),
    enabled: isAdmin && section === "users",
  });

  const orgsQuery = useQuery({
    queryKey: ["platform-admin", "organizations", orgSearch],
    queryFn: () =>
      listPlatformAdminOrganizations({
        q: orgSearch.trim() || undefined,
        limit: 50,
      }),
    enabled: isAdmin && section === "organizations",
  });

  const auditQuery = useQuery({
    queryKey: [
      "platform-admin",
      "audit-logs",
      auditFilter,
      auditFrom,
      auditTo,
      auditPage,
      auditPageSize,
      section,
    ],
    queryFn: () =>
      listPlatformAdminAuditLogs({
        action: section === "audit" ? auditFilter.trim() || undefined : undefined,
        from: section === "audit" ? toIsoBoundary(auditFrom, false) : undefined,
        to: section === "audit" ? toIsoBoundary(auditTo, true) : undefined,
        limit: section === "overview" ? 8 : auditPageSize,
        offset: section === "overview" ? 0 : (auditPage - 1) * auditPageSize,
      }),
    enabled: isAdmin && (section === "audit" || section === "overview"),
  });

  const securityOverviewQuery = useQuery({
    queryKey: ["platform-admin", "security-overview", securityDays],
    queryFn: () => getPlatformSecurityOverview(securityDays),
    enabled: isAdmin && (section === "overview" || section === "security"),
    refetchInterval: 60_000,
  });

  const threatOverviewQuery = useQuery({
    queryKey: ["platform-admin", "threat-overview", securityDays],
    queryFn: () => getPlatformThreatOverview(securityDays),
    enabled: isAdmin && (section === "overview" || section === "threats"),
    refetchInterval: 60_000,
  });

  const enforceMutation = useMutation({
    mutationFn: enforcePlatformAction,
    onSuccess: (res) => {
      toast.success(`Enforcement action applied (${res.result.action_type.replace(/_/g, " ")}).`);
      void queryClient.invalidateQueries({ queryKey: ["platform-admin"] });
      setEnforceReason("");
    },
    onError: (err) => {
      toast.error(formatErrorMessage(err));
    },
  });

  const attentionSummaryQuery = useQuery({
    queryKey: ["platform-admin", "attention-summary", securityDays],
    queryFn: () => getPlatformAttentionSummary(securityDays),
    enabled: isAdmin && section === "overview",
    refetchOnWindowFocus: false,
  });

  const securityEventsQuery = useQuery({
    queryKey: [
      "platform-admin",
      "security-events",
      section,
      eventCategory,
      eventSeverity,
      auditFrom,
      auditTo,
      eventPage,
      eventPageSize,
    ],
    queryFn: () =>
      listPlatformSecurityEvents({
        category: eventCategory || undefined,
        severity: eventSeverity || undefined,
        eventClass: section === "operational" ? "operational" : "security",
        from: toIsoBoundary(auditFrom, false),
        to: toIsoBoundary(auditTo, true),
        limit: eventPageSize,
        offset: (eventPage - 1) * eventPageSize,
      }),
    enabled: isAdmin && (section === "security-events" || section === "operational"),
    refetchInterval: 60_000,
  });

  const securityIncidentsQuery = useQuery({
    queryKey: [
      "platform-admin",
      "security-incidents",
      incidentStatus,
      incidentSeverity,
      incidentPage,
      incidentPageSize,
    ],
    queryFn: () =>
      listPlatformSecurityIncidents({
        status: incidentStatus || undefined,
        severity: incidentSeverity || undefined,
        limit: incidentPageSize,
        offset: (incidentPage - 1) * incidentPageSize,
      }),
    enabled: isAdmin && section === "incidents",
    refetchInterval: 60_000,
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: PlatformRole }) =>
      setPlatformAdminUserRole(userId, role),
    onSuccess: (res) => {
      toast.success(`Platform role updated to ${res.role}.`);
      void queryClient.invalidateQueries({ queryKey: ["platform-admin"] });
    },
    onError: (err) => {
      toast.error(formatErrorMessage(err));
    },
  });

  const isFinancialSection =
    section === "financial" || section === "financial-compliance" || section === "financial-anomalies";
  const isAiSection =
    section === "ai" || section === "ai-workspaces" || section === "ai-errors";

  const financialOverviewQuery = useQuery({
    queryKey: ["platform-admin", "financial-overview"],
    queryFn: getPlatformFinancialOverview,
    enabled: isAdmin && isFinancialSection,
    refetchOnWindowFocus: false,
  });

  const financialAnomaliesQuery = useQuery({
    queryKey: ["platform-admin", "financial-anomalies"],
    queryFn: listPlatformFinancialAnomalies,
    enabled: isAdmin && isFinancialSection,
    refetchOnWindowFocus: false,
  });

  const financialComplianceQuery = useQuery({
    queryKey: ["platform-admin", "financial-compliance"],
    queryFn: getPlatformFinancialCompliance,
    enabled: isAdmin && isFinancialSection,
    refetchOnWindowFocus: false,
  });

  const workspace360Query = useQuery({
    queryKey: ["platform-admin", "workspace-360", selectedOrg?.id],
    queryFn: () => getPlatformWorkspace360(selectedOrg!.id),
    enabled: isAdmin && Boolean(selectedOrg?.id),
  });

  const [aiDays, setAiDays] = useState<7 | 30>(7);
  const [aiSearch, setAiSearch] = useState("");
  const [visitorSearch, setVisitorSearch] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState<"" | "active" | "suspended" | "online">("");
  const effectiveAiDays = section === "overview" ? securityDays : aiDays;

  const realtimeVisitorsQuery = useQuery({
    queryKey: ["platform-admin", "realtime-visitors"],
    queryFn: getPlatformRealtimeVisitors,
    enabled: isAdmin && (section === "overview" || section === "visitors"),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const aiOverviewQuery = useQuery({
    queryKey: ["platform-admin", "ai-overview", effectiveAiDays],
    queryFn: () => getPlatformAIOverview(effectiveAiDays),
    enabled: isAdmin && (isAiSection || section === "overview"),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const aiWorkspacesQuery = useQuery({
    queryKey: ["platform-admin", "ai-workspaces", effectiveAiDays, isAiSection ? aiSearch : ""],
    queryFn: () =>
      listPlatformAIWorkspaces({
        days: effectiveAiDays,
        q: isAiSection ? aiSearch.trim() || undefined : undefined,
      }),
    enabled: isAdmin && (isAiSection || section === "overview"),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const aiQuotaMutation = useMutation({
    mutationFn: (payload: {
      organizationId: string;
      organizationName: string;
      aiEnabled: boolean;
      dailyRequestLimit: number;
      monthlyTokenLimit: number;
      reason: string;
    }) =>
      setPlatformWorkspaceAIQuota(payload.organizationId, {
        aiEnabled: payload.aiEnabled,
        dailyRequestLimit: payload.dailyRequestLimit,
        monthlyTokenLimit: payload.monthlyTokenLimit,
        reason: payload.reason,
      }),
    onSuccess: (_res, vars) => {
      toast.success(`Updated Bani AI quota for ${vars.organizationName}.`);
      void queryClient.invalidateQueries({ queryKey: ["platform-admin", "ai-workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-admin", "ai-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-admin", "workspace-360-extended"] });
    },
    onError: (err) => {
      toast.error(formatErrorMessage(err));
    },
  });

  const userDetailsQuery = useQuery({
    queryKey: ["platform-admin", "user-details", selectedUser?.id],
    queryFn: () => getPlatformUserDetails(selectedUser!.id),
    enabled: isAdmin && Boolean(selectedUser?.id),
  });

  const org360ExtendedQuery = useQuery({
    queryKey: ["platform-admin", "workspace-360-extended", selectedOrg?.id],
    queryFn: () => getPlatformOrg360Extended(selectedOrg!.id, 30),
    enabled: isAdmin && Boolean(selectedOrg?.id),
  });

  const userSuspensionMutation = useMutation({
    mutationFn: ({ userId, suspended, reason }: { userId: string; suspended: boolean; reason?: string }) =>
      setPlatformAdminUserSuspension(userId, suspended, reason),
    onSuccess: (res) => {
      toast.success(res.result.suspended ? "Account suspended." : "Account restored.");
      setSelectedUser((prev) =>
        prev && prev.id === res.result.user_id
          ? {
              ...prev,
              suspended_at: res.result.suspended ? new Date().toISOString() : null,
              suspension_reason: res.result.suspended ? res.result.reason : null,
            }
          : prev
      );
      void queryClient.invalidateQueries({ queryKey: ["platform-admin"] });
    },
    onError: (err) => {
      toast.error(formatErrorMessage(err));
    },
  });

  const orgSuspensionMutation = useMutation({
    mutationFn: ({ orgId, suspended, reason }: { orgId: string; suspended: boolean; reason?: string }) =>
      setPlatformAdminOrgSuspension(orgId, suspended, reason),
    onSuccess: (res) => {
      toast.success(res.result.suspended ? "Workspace suspended." : "Workspace restored.");
      setSelectedOrg((prev) =>
        prev && prev.id === res.result.organization_id
          ? {
              ...prev,
              suspended_at: res.result.suspended ? new Date().toISOString() : null,
              suspension_reason: res.result.suspended ? res.result.reason : null,
            }
          : prev
      );
      void queryClient.invalidateQueries({ queryKey: ["platform-admin"] });
    },
    onError: (err) => {
      toast.error(formatErrorMessage(err));
    },
  });

  const createIncidentMutation = useMutation({
    mutationFn: createPlatformSecurityIncident,
    onSuccess: () => {
      toast.success("Security incident created.");
      closeRightPanel();
      setSection("incidents");
      void queryClient.invalidateQueries({ queryKey: ["platform-admin"] });
    },
    onError: (err) => {
      toast.error(formatErrorMessage(err));
    },
  });

  const updateIncidentMutation = useMutation({
    mutationFn: ({
      incidentId,
      status,
      resolutionNotes,
    }: {
      incidentId: string;
      status: IncidentStatus;
      resolutionNotes?: string;
    }) => updatePlatformSecurityIncident(incidentId, { status, resolutionNotes }),
    onSuccess: (res) => {
      toast.success(`Incident marked as ${res.incident.status.replace("_", " ")}.`);
      setSelectedIncident((prev) =>
        prev && prev.id === res.incident.id
          ? { ...prev, status: res.incident.status, resolved_at: res.incident.resolved_at, resolution_notes: triageNotes || prev.resolution_notes }
          : prev
      );
      void queryClient.invalidateQueries({ queryKey: ["platform-admin"] });
    },
    onError: (err) => {
      toast.error(formatErrorMessage(err));
    },
  });

  const handleExportAuditCsv = async () => {
    try {
      setIsExportingCsv(true);
      const blob = await exportPlatformAdminAuditLogsCsv({
        action: auditFilter.trim() || undefined,
        from: toIsoBoundary(auditFrom, false),
        to: toIsoBoundary(auditTo, true),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `platform-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Audit logs exported.");
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleExportEventsCsv = async () => {
    try {
      setIsExportingEventsCsv(true);
      const blob = await exportPlatformSecurityEventsCsv({
        category: eventCategory || undefined,
        severity: eventSeverity || undefined,
        from: toIsoBoundary(auditFrom, false),
        to: toIsoBoundary(auditTo, true),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `platform-security-events-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Security events exported.");
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setIsExportingEventsCsv(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6 text-primary font-body">
        <div className="max-w-md w-full admin-card p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-heading font-medium text-primary tracking-tight">
            Platform Admin Access Required
          </h1>
          <p className="text-sm text-secondary font-body">
            Your account does not hold a platform administrator role.
          </p>
          <div className="pt-2">
            <Button variant="primary" to="/dashboard" icon={<ArrowLeft className="w-4 h-4" />}>
              Return to Organizations
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const overview = overviewQuery.data?.overview;
  const health = overviewQuery.data?.health;
  const securityOverview = securityOverviewQuery.data?.overview;
  const isDataFetching =
    overviewQuery.isFetching ||
    securityOverviewQuery.isFetching ||
    usersQuery.isFetching ||
    orgsQuery.isFetching ||
    auditQuery.isFetching ||
    securityEventsQuery.isFetching ||
    securityIncidentsQuery.isFetching ||
    financialOverviewQuery.isFetching ||
    financialAnomaliesQuery.isFetching;

  const totalUsers = overview?.total_users ?? 0;
  const superAdmins = overview?.super_admin_count ?? 0;
  const admins = overview?.admin_count ?? 0;
  const standardUsers = Math.max(0, totalUsers - superAdmins - admins);
  const privilegedTotal = superAdmins + admins;
  const privilegedPct = totalUsers > 0 ? Math.round((privilegedTotal / totalUsers) * 100) : 0;
  const avgMembersPerOrg =
    overview && overview.total_organizations > 0
      ? (overview.active_memberships / overview.total_organizations).toFixed(1)
      : "0.0";

  const navSections: Array<{
    title: string;
    links: Array<{ id: AdminSection; label: string; icon: React.ReactNode }>;
  }> = [
    {
      title: "Core",
      links: [
        {
          id: "overview" as const,
          label: "Overview",
          icon: <AnimatedDashboardIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "visitors" as const,
          label: "Visitors & Analytics",
          icon: <AnimatedGlobeIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "organizations" as const,
          label: "Workspaces",
          icon: <AnimatedBuildingIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "users" as const,
          label: "Users & Roles",
          icon: <AnimatedUsersIcon className="w-[18px] h-[18px]" />,
        },
      ],
    },
    {
      title: "Security & Operations",
      links: [
        {
          id: "security" as const,
          label: "Security Telemetry",
          icon: <AnimatedShieldCheckIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "threats" as const,
          label: "Threat Detection",
          icon: <AnimatedShieldAlertIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "security-events" as const,
          label: "Security Events",
          icon: <AnimatedShieldIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "operational" as const,
          label: "Operational Monitoring",
          icon: <AnimatedActivityIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "incidents" as const,
          label: "Incidents",
          icon: <AnimatedAlertTriangleIcon className="w-[18px] h-[18px]" />,
        },
      ],
    },
    {
      title: "Finance",
      links: [
        {
          id: "financial" as const,
          label: "Ledger & Trends",
          icon: <AnimatedLandmarkIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "financial-compliance" as const,
          label: "Compliance & Aging",
          icon: <AnimatedClockIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "financial-anomalies" as const,
          label: "Anomalies & Flags",
          icon: <AnimatedShieldAlertIcon className="w-[18px] h-[18px]" />,
        },
      ],
    },
    {
      title: "AI",
      links: [
        {
          id: "ai" as const,
          label: "Overview & Trends",
          icon: <AnimatedBotIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "ai-workspaces" as const,
          label: "Workspace Quotas",
          icon: <AnimatedSlidersIcon className="w-[18px] h-[18px]" />,
        },
        {
          id: "ai-errors" as const,
          label: "Errors & Throttles",
          icon: <AnimatedCpuIcon className="w-[18px] h-[18px]" />,
        },
      ],
    },
    {
      title: "Compliance",
      links: [
        {
          id: "audit" as const,
          label: "Audit Logs",
          icon: <AnimatedHistoryIcon className="w-[18px] h-[18px]" />,
        },
      ],
    },
  ];

  const sidebarNeedle = sidebarSearch.trim().toLowerCase();
  const filteredNavSections = sidebarNeedle
    ? navSections
        .map((group) => {
          const groupMatches = group.title.toLowerCase().includes(sidebarNeedle);
          const links = groupMatches
            ? group.links
            : group.links.filter((link) => link.label.toLowerCase().includes(sidebarNeedle));
          return { ...group, links };
        })
        .filter((group) => group.links.length > 0)
    : navSections;

  const selectSection = (next: AdminSection) => {
    setIsMobileDrawerOpen(false);
    startTransition(() => {
      if (next === "security-events" || next === "operational") {
        setEventPage(1);
      }
      setSection(next);
    });
  };

  return (
    <div className="workspace-layout [--workspace-navbar-height:3.5rem] h-screen max-h-screen bg-canvas text-primary flex flex-col font-body font-normal relative overflow-hidden">
      {/* Top Admin Navigation Bar */}
      <header className="app-navbar-surface h-(--workspace-navbar-height) shrink-0 border-b border-subtle dark:border-white/[0.08] bg-surface/95 dark:bg-[#09090b]/90 sticky top-0 z-40 px-4 sm:px-6 flex items-center justify-between hardware-sharp relative backdrop-blur-xl max-md:gap-2 max-md:px-3">
        {isDataFetching && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-subtle overflow-hidden z-50">
            <div className="animate-loading-bar bg-action" />
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-2.5 max-md:min-w-0 max-md:flex-1">
          <Link
            to="/dashboard"
            onClick={(e) => {
              e.preventDefault();
              navigateWithTransition(() => navigate("/dashboard"));
            }}
            className="app-brand-mark hidden items-center gap-2.5 shrink-0 md:flex group"
          >
            <BantaiLogo
              alt="Bantai"
              className="w-7 h-7 object-contain dark:drop-shadow-[0_0_12px_rgba(255,255,255,0.2)] transition-transform duration-200 group-hover:scale-105"
            />
            <span className="font-heading font-medium text-lg tracking-tight text-primary">
              Bantai
            </span>
          </Link>

          <span className="text-muted/60 hidden md:inline select-none">/</span>

          <Link
            to="/app"
            onClick={(e) => {
              e.preventDefault();
              navigateWithTransition(() => navigate("/app"));
            }}
            className="hidden shrink-0 text-xs font-medium text-secondary hover:text-primary transition-colors md:inline-flex items-center px-2 py-1 rounded-md hover:bg-white/[0.04]"
          >
            My Organizations
          </Link>

          <span className="hidden text-muted/60 md:inline select-none">/</span>

          {/* Mobile Drawer Toggle */}
          <button
            type="button"
            onClick={() => setIsMobileDrawerOpen(true)}
            aria-label="Open admin navigation"
            className="flex size-9 shrink-0 items-center justify-center md:hidden rounded-lg bg-elevated border border-subtle text-secondary hover:text-primary cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => selectSection("overview")}
            className="inline-flex items-center gap-2 h-8 px-2.5 rounded-lg bg-elevated/80 dark:bg-white/[0.04] border border-subtle dark:border-white/[0.08] hover:border-accent/50 text-xs font-medium text-primary transition-colors cursor-pointer shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-action shrink-0" />
            <span className="truncate">Platform Admin</span>
            <Badge>{isSuperAdmin ? "Super Admin" : "Admin"}</Badge>
          </button>

          {section !== "overview" && (
            <>
              <span className="hidden lg:inline text-muted/60 select-none">/</span>
              <span className="hidden lg:inline-flex items-center text-xs font-mono text-secondary truncate max-w-[200px]">
                {navSections.flatMap((g) => g.links).find((l) => l.id === section)?.label ?? section}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <div
            title={
              health
                ? `System Status: ${health.status === "ok" ? "Operational" : health.status.toUpperCase()} · Instance Uptime: ${
                    health.uptimeSeconds >= 3600
                      ? `${Math.floor(health.uptimeSeconds / 3600)}h ${Math.floor((health.uptimeSeconds % 3600) / 60)}m`
                      : `${Math.max(1, Math.floor(health.uptimeSeconds / 60))}m`
                  } · Environment: ${health.nodeEnv}`
                : "Checking system health"
            }
            className="hidden xl:inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.03] text-[11px] font-medium text-secondary"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                health?.status === "ok"
                  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.75)]"
                  : health
                  ? "bg-amber-400"
                  : "bg-zinc-500 animate-pulse"
              }`}
            />
            <span className="text-primary">
              {health?.status === "ok"
                ? "All Systems Operational"
                : health
                ? "Degraded Performance"
                : "Checking Status…"}
            </span>
            {health && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted border-l border-white/[0.08] pl-2">
                {health.nodeEnv === "production" ? "Prod" : health.nodeEnv}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => selectSection("visitors")}
            title="View online visitors & analytics"
            className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.03] hover:bg-white/[0.06] text-[11px] font-mono text-secondary hover:text-primary transition-colors cursor-pointer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.75)]" />
            <span className="text-primary tabular-nums">
              {realtimeVisitorsQuery.data?.realtime.active_visitors ?? 0}
            </span>
            <span className="text-muted">Online</span>
          </button>

          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["platform-admin"] })}
            title="Refresh admin telemetry"
            aria-label="Refresh admin telemetry"
            className="grid size-8 place-items-center rounded-lg border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.03] hover:bg-white/[0.06] text-secondary hover:text-primary transition-colors cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isDataFetching ? "animate-spin text-action" : ""}`} />
          </button>

          <div className="hidden sm:block h-4 w-px bg-subtle mx-0.5" />

          <NotificationBell />
          <UserMenu compactOnMobile />
        </div>
      </header>

      {/* Main Container: Collapsible Sidebar + Scrollable Content */}
      <div className="workspace-body flex-1 flex overflow-hidden min-h-0">
        {/* Desktop Collapsible Sidebar */}
        <aside
          className={`hidden md:flex flex-col shrink-0 border-r border-subtle workspace-sidebar-surface transition-all duration-300 relative z-20 min-h-0 select-none ${
            isSidebarCollapsed ? "w-[72px]" : "w-60"
          }`}
        >
          {!isSidebarCollapsed && (
            <div className="px-2.5 pt-3 pb-1 flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  placeholder="Search modules..."
                  aria-label="Search admin modules"
                  className="w-full h-8 pl-8 pr-6 rounded-lg bg-[#09090b] border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent"
                />
                {sidebarSearch && (
                  <button
                    type="button"
                    onClick={() => setSidebarSearch("")}
                    aria-label="Clear module search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Collapse sidebar"
                className="group grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary hover:bg-hover-surface hover:text-primary"
              >
                <PanelLeftClose size={14} className="sidebar-nav-icon transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
              </button>
            </div>
          )}

          <nav className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2.5">
            {filteredNavSections.length === 0 ? (
              !isSidebarCollapsed && (
                <p className="px-2.5 py-4 text-xs text-muted text-center">
                  No modules match "{sidebarSearch}".
                </p>
              )
            ) : (
              filteredNavSections.map((group, sIdx) => (
              <div key={group.title} className="space-y-0.5">
                {!isSidebarCollapsed ? (
                  sIdx === 0 ? (
                    <div className="px-2.5 pb-1">
                      <span className="text-[11px] font-medium text-muted">
                        {group.title}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="border-t border-subtle my-2.5 mx-2" />
                      <div className="px-2.5 pb-1 text-[11px] font-medium text-muted">
                        {group.title}
                      </div>
                    </>
                  )
                ) : sIdx === 0 ? (
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    aria-label="Expand sidebar"
                    className="group mx-auto mb-1 grid size-7 cursor-pointer place-items-center rounded-lg text-secondary hover:bg-hover-surface hover:text-primary"
                  >
                    <PanelLeft size={14} className="sidebar-nav-icon transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                  </button>
                ) : (
                  <div className="border-t border-subtle my-2 mx-2" />
                )}

                {group.links.map((link) => {
                  const isActive = section === link.id;
                  return (
                    <button
                      key={link.id}
                      type="button"
                      onClick={() => selectSection(link.id)}
                      title={link.label}
                      className={`group w-full flex items-center gap-3 rounded-lg text-[13px] border outline-none select-none transition-colors duration-150 cursor-pointer ${
                        isActive
                          ? "bg-selected-surface text-primary font-medium border-subtle dark:border-transparent shadow-xs dark:shadow-none"
                          : "border-transparent text-primary/80 dark:text-secondary hover:text-primary hover:bg-hover-surface font-medium dark:font-normal"
                      } ${
                        isSidebarCollapsed
                          ? "w-10 h-10 mx-auto justify-center p-0"
                          : "px-2.5 py-1.5"
                      }`}
                    >
                      <span className="shrink-0 flex items-center justify-center">
                        {link.icon}
                      </span>
                      {!isSidebarCollapsed && (
                        <span className="truncate">{link.label}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              ))
            )}
          </nav>
        </aside>

        {/* Mobile Slide-Out Drawer */}
        <div
          className="mobile-drawer fixed inset-0 z-50 flex md:hidden"
          data-open={isMobileDrawerOpen}
          inert={!isMobileDrawerOpen}
        >
          <div
            className="mobile-drawer-backdrop fixed inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={() => setIsMobileDrawerOpen(false)}
          />
          <div className="mobile-drawer-panel relative w-72 max-w-[85vw] workspace-sidebar-surface border-r border-subtle flex flex-col p-5 shadow-2xl z-10">
            <div className="flex items-center justify-between pb-4 border-b border-subtle mb-4">
              <div className="flex items-center gap-2.5">
                <BantaiLogo alt="Bantai" className="w-6 h-6 object-contain" />
                <span className="font-heading font-medium text-base text-primary">
                  Platform Admin
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                aria-label="Close admin navigation"
                className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search modules..."
                aria-label="Search admin modules"
                className="w-full h-8 pl-8 pr-6 rounded-lg bg-[#09090b] border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent"
              />
              {sidebarSearch && (
                <button
                  type="button"
                  onClick={() => setSidebarSearch("")}
                  aria-label="Clear module search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <nav className="flex-1 space-y-4 overflow-y-auto">
              {filteredNavSections.length === 0 ? (
                <p className="px-2.5 py-4 text-xs text-muted text-center">
                  No modules match "{sidebarSearch}".
                </p>
              ) : (
                filteredNavSections.map((group) => (
                <div key={group.title} className="space-y-1">
                  <div className="px-2.5 pb-1 text-[11px] font-medium text-muted">
                    {group.title}
                  </div>
                  {group.links.map((link) => {
                    const isActive = section === link.id;
                    return (
                      <button
                        key={link.id}
                        type="button"
                        onClick={() => selectSection(link.id)}
                        className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                          isActive
                            ? "bg-selected-surface text-primary font-medium border border-subtle"
                            : "text-secondary hover:text-primary hover:bg-hover-surface"
                        }`}
                      >
                        {link.icon}
                        <span>{link.label}</span>
                      </button>
                    );
                  })}
                </div>
                ))
              )}
            </nav>
          </div>
        </div>

        {/* Main Workspace Content */}
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-subtle pb-4">
              <div className="space-y-1">
                <p className="text-[11px] font-mono uppercase tracking-wider text-muted">
                  System Administration
                </p>
                <h1 className="page-title">
                  <span className="text-display-gradient">
                    {section === "overview" && "Platform Overview"}
                    {section === "visitors" && "Visitors & Traffic Analytics"}
                    {section === "security" && "Security Telemetry"}
                    {section === "threats" && "Threat Detection"}
                    {section === "security-events" && "Security Events"}
                    {section === "operational" && "Operational Monitoring"}
                    {section === "incidents" && "Security Incidents"}
                    {section === "ai" && "Bani AI Overview & Trends"}
                    {section === "ai-workspaces" && "Bani AI Workspace Quotas"}
                    {section === "ai-errors" && "Bani AI Errors & Throttles"}
                    {section === "financial" && "Financial Ledger & Trends"}
                    {section === "financial-compliance" && "Financial Compliance & Aging"}
                    {section === "financial-anomalies" && "Financial Anomalies & Flags"}
                    {section === "users" && "Users & Global Roles"}
                    {section === "organizations" && "Workspaces"}
                    {section === "audit" && "Audit Logs"}
                  </span>
                </h1>
                <p className="text-xs text-secondary">
                  {section === "overview" && "Real-time platform health, activity trends, and prioritized operational attention."}
                  {section === "visitors" && "Live online sessions (5m window) and rolling 24-hour route traffic analytics across Bantai."}
                  {section === "security" && "Real-time security telemetry, burst alerts, and system health metrics."}
                  {section === "threats" && "Brute-force threat detection, suspicious IP monitoring, and session timeout policy."}
                  {section === "security-events" && "Authentication failures, access denials, and policy enforcement event stream."}
                  {section === "operational" && "Backend 5xx responses and dependency degradation isolated from security threats."}
                  {section === "incidents" && "Track, triage, and resolve escalated platform security incidents."}
                  {section === "ai" && "Non-content Bani AI telemetry, token volume, latency, and daily usage trends."}
                  {section === "ai-workspaces" && "Per-workspace Bani AI request and monthly token quota governance."}
                  {section === "ai-errors" && "Recent Bani AI failure telemetry and workspace rate-limit throttles."}
                  {section === "financial" && "Privacy-preserving aggregate ledger totals and cross-workspace financial trends."}
                  {section === "financial-compliance" && "Cash advance aging, pending expense approvals, and policy compliance checks."}
                  {section === "financial-anomalies" && "Deterministic workspace compliance flags and financial exception alerts."}
                  {section === "users" && "Global role distribution, account status governance, and user security history."}
                  {section === "organizations" && "Workspace directory, lifecycle status, and 360° operational inspection."}
                  {section === "audit" && "Immutable administrative, role, workspace, and financial audit trail."}
                </p>
              </div>
              {section === "overview" && (
                <button
                  type="button"
                  onClick={() => selectSection("visitors")}
                  className="inline-flex items-center gap-2 rounded-full border border-subtle bg-surface px-3 py-1.5 text-xs font-mono text-secondary hover:text-primary hover:border-accent transition-colors self-start sm:self-auto cursor-pointer shrink-0"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.65)]" />
                  <span className="text-primary tabular-nums">
                    {realtimeVisitorsQuery.data?.realtime.active_visitors ?? 0}
                  </span>
                  <span>Online</span>
                  <ArrowRight className="w-3 h-3 text-muted" />
                </button>
              )}
              {section === "security-events" && (
                <div className="self-start sm:self-auto shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleExportEventsCsv}
                    disabled={isExportingEventsCsv}
                    icon={<Download className="w-3.5 h-3.5" />}
                  >
                    {isExportingEventsCsv ? "Exporting..." : "Export CSV"}
                  </Button>
                </div>
              )}
              {section === "audit" && (
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
                  <div className="inline-flex rounded-xl border border-subtle bg-surface p-1 text-xs" role="group" aria-label="Audit log view mode">
                    <button
                      type="button"
                      onClick={() => toggleAuditViewMode("normal")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors cursor-pointer ${
                        auditViewMode === "normal"
                          ? "bg-selected-surface text-primary shadow-xs"
                          : "text-secondary hover:text-primary"
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Normal View
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleAuditViewMode("developer")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors cursor-pointer ${
                        auditViewMode === "developer"
                          ? "bg-selected-surface text-primary shadow-xs"
                          : "text-secondary hover:text-primary"
                      }`}
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      Developer View
                    </button>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleExportAuditCsv}
                    disabled={isExportingCsv}
                    icon={<Download className="w-3.5 h-3.5" />}
                  >
                    {isExportingCsv ? "Exporting..." : "Export CSV"}
                  </Button>
                </div>
              )}
            </div>

            {/* OVERVIEW SECTION */}
            {section === "overview" && (
              <div className="space-y-6">
                {(overviewQuery.isError || securityOverviewQuery.isError) && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
                    <span>
                      {formatErrorMessage(overviewQuery.error || securityOverviewQuery.error)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void overviewQuery.refetch();
                        void securityOverviewQuery.refetch();
                      }}
                      className="font-medium underline cursor-pointer shrink-0"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Platform Overview KPI Metric Cards */}
                <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 items-stretch gap-4">
                  <div className="animate-activity-stagger" style={{ "--stagger-index": 0 } as React.CSSProperties}>
                    <div className="admin-kpi-card flex flex-col justify-between h-full">
                      <div>
                        <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                          <span className="font-mono uppercase tracking-wider text-[11px] sm:text-xs">
                            Total Users
                          </span>
                          <span className="admin-kpi-icon text-secondary">
                            <Users className="w-4 h-4 shrink-0" />
                          </span>
                        </div>
                        <p className="overview-kpi-value tabular-nums text-primary">
                          {overview ? <AnimatedNumber value={overview.total_users} /> : "—"}
                        </p>
                      </div>
                      <p className="mt-2.5 text-[11px] font-mono tabular-nums text-muted">
                        {attentionSummaryQuery.data?.summary.suspended_accounts ?? 0} suspended · {overview?.active_memberships ?? 0} memberships
                      </p>
                    </div>
                  </div>

                  <div className="animate-activity-stagger" style={{ "--stagger-index": 1 } as React.CSSProperties}>
                    <div className="admin-kpi-card flex flex-col justify-between h-full">
                      <div>
                        <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                          <span className="font-mono uppercase tracking-wider text-[11px] sm:text-xs">
                            Active Workspaces
                          </span>
                          <span className="admin-kpi-icon text-emerald-400">
                            <Building2 className="w-4 h-4 shrink-0" />
                          </span>
                        </div>
                        <p className="overview-kpi-value tabular-nums text-primary">
                          {attentionSummaryQuery.data ? (
                            <AnimatedNumber value={attentionSummaryQuery.data.summary.active_workspaces} />
                          ) : overview ? (
                            <AnimatedNumber value={overview.total_organizations} />
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                      <p className="mt-2.5 text-[11px] font-mono tabular-nums text-muted">
                        {attentionSummaryQuery.data?.summary.suspended_workspaces ?? 0} suspended · avg {avgMembersPerOrg}/org
                      </p>
                    </div>
                  </div>

                  <div className="animate-activity-stagger" style={{ "--stagger-index": 2 } as React.CSSProperties}>
                    <button
                      type="button"
                      onClick={() => {
                        selectSection("incidents");
                      }}
                      className="w-full text-left admin-kpi-card flex flex-col justify-between h-full cursor-pointer"
                    >
                      <div>
                        <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                          <span className="font-mono uppercase tracking-wider text-[11px] sm:text-xs">
                            Open Security Alerts
                          </span>
                          <span className="admin-kpi-icon text-rose-400">
                            <ShieldAlert className="w-4 h-4 shrink-0" />
                          </span>
                        </div>
                        <p className="overview-kpi-value tabular-nums text-primary">
                          {attentionSummaryQuery.data ? (
                            <AnimatedNumber value={attentionSummaryQuery.data.summary.open_security_alerts} />
                          ) : securityOverview ? (
                            <AnimatedNumber value={securityOverview.open_incidents} />
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                      <p className="mt-2.5 text-[11px] font-mono tabular-nums text-muted">
                        {securityOverview?.denied_403 ?? 0} denied · {securityOverview?.rate_limited_429 ?? 0} rate-limited
                      </p>
                    </button>
                  </div>

                  <div className="animate-activity-stagger" style={{ "--stagger-index": 3 } as React.CSSProperties}>
                    <button
                      type="button"
                      onClick={() => selectSection("financial")}
                      className="w-full text-left admin-kpi-card flex flex-col justify-between h-full cursor-pointer"
                    >
                      <div>
                        <div className="flex items-center justify-between text-muted text-xs mb-1.5 sm:mb-2">
                          <span className="font-mono uppercase tracking-wider text-[11px] sm:text-xs">
                            Financial Exceptions
                          </span>
                          <span className="admin-kpi-icon text-amber-400">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                          </span>
                        </div>
                        <p className="overview-kpi-value tabular-nums text-primary">
                          {attentionSummaryQuery.data ? (
                            <AnimatedNumber value={attentionSummaryQuery.data.summary.financial_exceptions_count} />
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                      <p className="mt-2.5 text-[11px] font-mono tabular-nums text-muted">
                        Over-budget, disputed, or backlog flags
                      </p>
                    </button>
                  </div>
                </section>

                {/* Row 2: Platform Activity Chart + Attention Required */}
                <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                  <div className="lg:col-span-7 admin-card p-5 flex flex-col justify-between gap-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-medium text-primary flex items-center gap-2">
                          <Activity className="w-4 h-4 text-action" />
                          Platform Activity ({securityDays}d)
                        </h2>
                        <p className="text-xs text-secondary">
                          Audit trail events vs. genuine security signals across all workspaces.
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="hidden sm:flex items-center gap-2.5 text-[11px] font-mono text-secondary">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            Audit
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            Security
                          </span>
                        </div>
                        <div className="inline-flex rounded-xl border border-subtle bg-elevated p-0.5 text-[11px]" role="group" aria-label="Overview trend window">
                          {([7, 30] as const).map((days) => (
                            <button
                              key={days}
                              type="button"
                              onClick={() => setSecurityDays(days)}
                              className={`rounded-lg px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                                securityDays === days
                                  ? "bg-selected-surface text-primary shadow-xs"
                                  : "text-secondary hover:text-primary"
                              }`}
                            >
                              {days}d
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            selectSection("security");
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-action hover:underline cursor-pointer"
                        >
                          Security Center
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <SecurityTrendLineChart
                      data={(attentionSummaryQuery.data?.summary.activity_trend ?? []).map((pt) => ({
                        day: pt.day,
                        total: pt.audit_events,
                        high_critical: pt.security_events,
                      }))}
                      height={180}
                      primaryLabel="Audit Activity"
                      secondaryLabel="Security Events"
                      primaryColor="#10b981"
                      secondaryColor="#f59e0b"
                      emptyMessage={`No platform activity recorded in the last ${securityDays} days.`}
                    />
                  </div>

                  <div className="lg:col-span-5 admin-card p-5 flex flex-col justify-between gap-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-medium text-primary flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 text-amber-400" />
                          Attention Required
                        </h2>
                        <p className="text-xs text-secondary">
                          Brute-force alerts, restrictions, AI quota warnings, and financial exceptions.
                        </p>
                      </div>
                    </div>

                    {(() => {
                      type OverviewAttentionEntry = {
                        key: string;
                        title: string;
                        subtitle: string;
                        severity: "critical" | "high" | "medium" | "low";
                        tag: string;
                        onClick: () => void;
                      };

                      const entries: OverviewAttentionEntry[] = [];

                      for (const item of attentionSummaryQuery.data?.summary.attention_items ?? []) {
                        entries.push({
                          key: `${item.type}-${item.id}`,
                          title: item.title,
                          subtitle: item.subtitle,
                          severity: item.severity,
                          tag:
                            item.type === "incident"
                              ? "Incident"
                              : item.type === "financial_exception"
                                ? "Finance"
                                : item.type === "suspended_user"
                                  ? "Account"
                                  : "Workspace",
                          onClick: () => {
                            if (item.type === "incident") {
                              selectSection("incidents");
                            } else if (item.type === "financial_exception") {
                              selectSection("financial");
                            } else if (item.type === "suspended_user") {
                              selectSection("users");
                            } else {
                              selectSection("organizations");
                            }
                          },
                        });
                      }

                      for (const src of threatOverviewQuery.data?.overview.suspicious_sources ?? []) {
                        if (src.attempts >= 5 || src.risk_level === "high" || src.risk_level === "critical") {
                          entries.push({
                            key: `brute-${src.source_ip}`,
                            title: `Brute-force source ${src.source_ip}`,
                            subtitle: `${src.attempts} attempts · risk score ${src.risk_score}${
                              src.restriction_status === "restricted" ? " (restricted)" : ""
                            }`,
                            severity: src.risk_level === "critical" ? "critical" : "high",
                            tag: "Brute Force",
                            onClick: () => {
                              selectSection("threats");
                            },
                          });
                        }
                      }

                      for (const acct of threatOverviewQuery.data?.overview.account_lockouts ?? []) {
                        const isSuspended = Boolean(acct.suspended_at);
                        const isLocked = Boolean(acct.locked_until);
                        if (isSuspended || isLocked) {
                          entries.push({
                            key: `lockout-${acct.user_id}`,
                            title: acct.display_name || acct.email || acct.user_id,
                            subtitle: isSuspended
                              ? acct.suspension_reason || "Account suspended"
                              : acct.lock_reason || "Temporary account lockout active",
                            severity: isSuspended ? "critical" : "high",
                            tag: "Restriction",
                            onClick: () => {
                              selectSection("threats");
                            },
                          });
                        }
                      }

                      for (const ws of aiWorkspacesQuery.data?.workspaces ?? []) {
                        const reqRatio = ws.daily_request_limit > 0 ? ws.daily_requests_used / ws.daily_request_limit : 0;
                        const tokRatio = ws.monthly_token_limit > 0 ? ws.monthly_tokens_used / ws.monthly_token_limit : 0;
                        if (!ws.ai_enabled || ws.period_rate_limited > 0 || reqRatio >= 0.8 || tokRatio >= 0.8) {
                          entries.push({
                            key: `ai-quota-${ws.organization_id}`,
                            title: `${ws.organization_name} AI Quota`,
                            subtitle: !ws.ai_enabled
                              ? "Bani AI disabled for workspace"
                              : ws.period_rate_limited > 0
                                ? `${ws.period_rate_limited} rate-limited requests (${securityDays}d)`
                                : `${Math.round(Math.max(reqRatio, tokRatio) * 100)}% of quota consumed`,
                            severity: !ws.ai_enabled || reqRatio >= 0.95 || tokRatio >= 0.95 ? "high" : "medium",
                            tag: "AI Quota",
                            onClick: () => selectSection("ai"),
                          });
                        }
                      }

                      const severityRank: Record<OverviewAttentionEntry["severity"], number> = {
                        critical: 0,
                        high: 1,
                        medium: 2,
                        low: 3,
                      };
                      const sortedEntries = entries
                        .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
                        .slice(0, 6);

                      const isCheckingAlerts =
                        attentionSummaryQuery.isLoading &&
                        threatOverviewQuery.isLoading &&
                        aiWorkspacesQuery.isLoading;

                      if (isCheckingAlerts) {
                        return (
                          <div className="py-8 text-center text-xs text-secondary">
                            Checking platform alerts...
                          </div>
                        );
                      }

                      if (sortedEntries.length > 0) {
                        return (
                          <ul className="space-y-2">
                            {sortedEntries.map((item) => (
                              <li key={item.key}>
                                <button
                                  type="button"
                                  onClick={item.onClick}
                                  className="w-full text-left rounded-xl border border-subtle bg-elevated/40 hover:bg-hover-surface/60 hover:border-strong px-3.5 py-2 transition-colors cursor-pointer flex items-center justify-between gap-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`w-2 h-2 rounded-full shrink-0 ${
                                          item.severity === "critical"
                                            ? "bg-rose-500"
                                            : item.severity === "high"
                                              ? "bg-amber-500"
                                              : "bg-sky-400"
                                        }`}
                                      />
                                      <p className="text-xs font-medium text-primary truncate">{item.title}</p>
                                      <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-subtle bg-white/[0.03] text-muted shrink-0">
                                        {item.tag}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-secondary truncate pl-4">{item.subtitle}</p>
                                  </div>
                                  <ArrowRight className="w-3.5 h-3.5 text-muted shrink-0" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        );
                      }

                      return (
                        <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-subtle bg-elevated/20 py-8 px-4 text-center">
                          <ShieldCheck className="w-6 h-6 text-emerald-400 mb-2" />
                          <p className="text-xs font-medium text-primary">All clear</p>
                          <p className="text-[11px] text-secondary">
                            No open incidents, brute-force alerts, AI quota warnings, or financial exceptions.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </section>

                {/* Row 2.5: Security Posture & Bani AI Usage Widgets */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Compact Security Posture Widget */}
                  <div className="admin-card p-5 flex flex-col justify-between gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-medium text-primary flex items-center gap-2">
                          <Shield className="w-4 h-4 text-amber-400" />
                          Security Posture ({securityDays}d)
                        </h2>
                        <p className="text-xs text-secondary">
                          Failed authentication attempts, blocked requests, and active lockouts.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          selectSection("threats");
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-action hover:underline cursor-pointer shrink-0"
                      >
                        Threat Detection
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {threatOverviewQuery.isError ? (
                      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300 flex items-center justify-between gap-3">
                        <span>Security posture metrics unavailable.</span>
                        <button
                          type="button"
                          onClick={() => void threatOverviewQuery.refetch()}
                          className="underline font-medium cursor-pointer shrink-0"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      (() => {
                        const threat = threatOverviewQuery.data?.overview;
                        const failedAuthTotal = (threat?.failed_auth_trend ?? []).reduce(
                          (sum, pt) => sum + (pt.failed_auth ?? 0),
                          0
                        );
                        const activeLockouts = threat?.restricted_accounts ?? 0;
                        const blockedRequests = threat?.blocked_requests ?? 0;
                        return (
                          <>
                            <div className="grid grid-cols-3 gap-2.5">
                              <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                                  Failed Auth
                                </p>
                                <p className="text-lg font-heading font-semibold text-primary tabular-nums mt-0.5">
                                  {threatOverviewQuery.isLoading ? "…" : <AnimatedNumber value={failedAuthTotal} />}
                                </p>
                              </div>
                              <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                                  Blocked
                                </p>
                                <p className="text-lg font-heading font-semibold text-amber-400 tabular-nums mt-0.5">
                                  {threatOverviewQuery.isLoading ? "…" : <AnimatedNumber value={blockedRequests} />}
                                </p>
                              </div>
                              <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                                  Lockouts
                                </p>
                                <p className="text-lg font-heading font-semibold text-rose-400 tabular-nums mt-0.5">
                                  {threatOverviewQuery.isLoading ? "…" : <AnimatedNumber value={activeLockouts} />}
                                </p>
                              </div>
                            </div>

                            <SecurityTrendLineChart
                              data={(threat?.failed_auth_trend ?? []).map((pt) => ({
                                day: pt.day,
                                total: pt.failed_auth,
                                high_critical: pt.blocked_requests,
                              }))}
                              height={110}
                              primaryLabel="Failed Auth"
                              secondaryLabel="Blocked"
                              primaryColor="#f59e0b"
                              secondaryColor="#f43f5e"
                              emptyMessage={`No failed authentication or block events in the last ${securityDays} days.`}
                            />
                          </>
                        );
                      })()
                    )}
                  </div>

                  {/* Compact Bani AI Usage Widget */}
                  <div className="admin-card p-5 flex flex-col justify-between gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-medium text-primary flex items-center gap-2">
                          <Bot className="w-4 h-4 text-emerald-400" />
                          Bani AI Usage ({securityDays}d)
                        </h2>
                        <p className="text-xs text-secondary">
                          Requests, token consumption, estimated API cost, and active workspaces.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => selectSection("ai")}
                        className="inline-flex items-center gap-1 text-xs font-medium text-action hover:underline cursor-pointer shrink-0"
                      >
                        AI Monitoring
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {aiOverviewQuery.isError ? (
                      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300 flex items-center justify-between gap-3">
                        <span>Bani AI telemetry unavailable.</span>
                        <button
                          type="button"
                          onClick={() => void aiOverviewQuery.refetch()}
                          className="underline font-medium cursor-pointer shrink-0"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      (() => {
                        const ai = aiOverviewQuery.data?.overview;
                        const summary = ai?.summary;
                        const totalRequests = summary?.total_requests ?? 0;
                        const totalTokens = summary?.total_tokens ?? 0;
                        const activeAiWorkspaces = summary?.active_workspaces ?? 0;
                        const estCostUsd =
                          ((summary?.total_prompt_tokens ?? 0) / 1_000_000) * 0.15 +
                          ((summary?.total_completion_tokens ?? 0) / 1_000_000) * 0.6;
                        const formatCompact = (n: number) =>
                          n >= 1_000_000
                            ? `${(n / 1_000_000).toFixed(1)}M`
                            : n >= 1_000
                              ? `${(n / 1_000).toFixed(1)}k`
                              : String(n);

                        return (
                          <>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                              <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                                  Requests
                                </p>
                                <p className="text-lg font-heading font-semibold text-primary tabular-nums mt-0.5">
                                  {aiOverviewQuery.isLoading ? "…" : <AnimatedNumber value={totalRequests} />}
                                </p>
                              </div>
                              <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                                  Tokens
                                </p>
                                <p className="text-lg font-heading font-semibold text-primary tabular-nums mt-0.5">
                                  {aiOverviewQuery.isLoading ? "…" : formatCompact(totalTokens)}
                                </p>
                              </div>
                              <div
                                className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5"
                                title="Estimated from persisted prompt ($0.15/1M) & completion ($0.60/1M) tokens"
                              >
                                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                                  Est. Cost
                                </p>
                                <p className="text-lg font-heading font-semibold text-emerald-400 tabular-nums mt-0.5">
                                  {aiOverviewQuery.isLoading ? "…" : `$${estCostUsd.toFixed(2)}`}
                                </p>
                              </div>
                              <div className="rounded-xl border border-subtle bg-elevated/40 px-3 py-2.5">
                                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                                  Workspaces
                                </p>
                                <p className="text-lg font-heading font-semibold text-primary tabular-nums mt-0.5">
                                  {aiOverviewQuery.isLoading ? "…" : <AnimatedNumber value={activeAiWorkspaces} />}
                                </p>
                              </div>
                            </div>

                            <SecurityTrendLineChart
                              data={(ai?.daily_series ?? []).map((pt) => ({
                                day: pt.date,
                                total: pt.requests,
                                high_critical: pt.errors + pt.rate_limited,
                              }))}
                              height={110}
                              primaryLabel="AI Requests"
                              secondaryLabel="Errors / Limits"
                              primaryColor="#10b981"
                              secondaryColor="#f59e0b"
                              emptyMessage={`No Bani AI requests recorded in the last ${securityDays} days.`}
                            />
                          </>
                        );
                      })()
                    )}
                  </div>
                </section>

                {/* Recent Audit Events Preview */}
                <section className="admin-table-shell overflow-hidden">
                    <div className="px-5 py-4 border-b border-subtle space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-medium text-primary">Recent Audit & Security Events</h2>
                          <p className="text-xs text-secondary">Latest 8 events recorded across the system.</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="inline-flex rounded-xl border border-subtle bg-elevated p-0.5 text-[11px]" role="group" aria-label="Audit log view mode">
                            <button
                              type="button"
                              onClick={() => toggleAuditViewMode("normal")}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                                auditViewMode === "normal"
                                  ? "bg-selected-surface text-primary shadow-xs"
                                  : "text-secondary hover:text-primary"
                              }`}
                            >
                              <Eye className="w-3 h-3" />
                              Normal
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleAuditViewMode("developer")}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                                auditViewMode === "developer"
                                  ? "bg-selected-surface text-primary shadow-xs"
                                  : "text-secondary hover:text-primary"
                              }`}
                            >
                              <Code2 className="w-3 h-3" />
                              Developer
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => selectSection("audit")}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-action hover:underline cursor-pointer"
                          >
                            View all logs
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <EventSignificanceLegend />
                    </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
                        <tr>
                          <th className="px-4 py-3 font-medium">Timestamp</th>
                          <th className="px-4 py-3 font-medium">
                            {auditViewMode === "developer" ? "Action Key" : "Event"}
                          </th>
                          <th className="px-4 py-3 font-medium">Actor</th>
                          <th className="px-4 py-3 font-medium">Scope</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-subtle">
                        {auditQuery.isLoading ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center text-secondary">
                              Loading recent events...
                            </td>
                          </tr>
                        ) : auditQuery.data?.logs.length ? (
                          auditQuery.data.logs.map((log) => (
                            <tr
                              key={log.id}
                              onClick={() => openAuditLogPanel(log)}
                              className={`transition-colors cursor-pointer ${
                                selectedAuditLog?.id === log.id
                                  ? "bg-selected-surface"
                                  : "hover:bg-hover-surface/60"
                              }`}
                            >
                              <td className="px-4 py-3 text-secondary whitespace-nowrap">
                                {new Date(log.occurred_at).toLocaleString()}
                              </td>
                              <td className="px-4 py-3">
                                {renderAuditEventBadge(log.action, auditViewMode)}
                              </td>
                              <td className="px-4 py-3 text-secondary">
                                {auditViewMode === "developer"
                                  ? log.actor_id || "system"
                                  : log.actor_name || "System"}
                              </td>
                              <td className="px-4 py-3 text-secondary">
                                {log.organization_name || "Platform"}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center text-secondary">
                              No audit events recorded yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {/* REAL-TIME VISITORS SECTION */}
            {section === "visitors" && (
              <section className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="admin-kpi-card space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="font-mono uppercase tracking-wider text-[11px]">
                        Active Now (5m)
                      </span>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.65)]" />
                    </div>
                    <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
                      <AnimatedNumber value={realtimeVisitorsQuery.data?.realtime.active_visitors ?? 0} />
                    </p>
                    <p className="text-[11px] text-secondary">
                      Auto-refreshes every 15s
                    </p>
                  </div>

                  <div className="admin-kpi-card space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="font-mono uppercase tracking-wider text-[11px]">
                        Authenticated
                      </span>
                      <span className="admin-kpi-icon text-emerald-400">
                        <Users className="w-4 h-4" />
                      </span>
                    </div>
                    <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
                      <AnimatedNumber value={realtimeVisitorsQuery.data?.realtime.authenticated_visitors ?? 0} />
                    </p>
                    <p className="text-[11px] text-secondary">Active workspace sessions</p>
                  </div>

                  <div className="admin-kpi-card space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="font-mono uppercase tracking-wider text-[11px]">
                        Public / Guests
                      </span>
                      <span className="admin-kpi-icon text-sky-400">
                        <Globe className="w-4 h-4" />
                      </span>
                    </div>
                    <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
                      <AnimatedNumber value={realtimeVisitorsQuery.data?.realtime.anonymous_visitors ?? 0} />
                    </p>
                    <p className="text-[11px] text-secondary">Landing & auth pages</p>
                  </div>

                  <div className="admin-kpi-card space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="font-mono uppercase tracking-wider text-[11px]">
                        Devices
                      </span>
                      <span className="admin-kpi-icon text-violet-400">
                        <Activity className="w-4 h-4" />
                      </span>
                    </div>
                    <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
                      {realtimeVisitorsQuery.data?.realtime.devices.desktop ?? 0}
                      <span className="text-sm font-normal text-muted ml-1.5">desktop</span>
                    </p>
                    <p className="text-[11px] text-secondary tabular-nums">
                      {realtimeVisitorsQuery.data?.realtime.devices.mobile ?? 0} mobile ·{" "}
                      {realtimeVisitorsQuery.data?.realtime.devices.tablet ?? 0} tablet
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="admin-table-shell overflow-hidden">
                    <div className="px-4 py-3 border-b border-subtle">
                      <h3 className="text-xs font-medium text-primary">Top Active Pages</h3>
                      <p className="text-[11px] text-secondary">Routes with active visitors right now</p>
                    </div>
                    <div className="divide-y divide-subtle">
                      {!realtimeVisitorsQuery.data?.realtime.top_pages.length ? (
                        <div className="px-4 py-6 text-center text-xs text-secondary">
                          No active routes recorded yet.
                        </div>
                      ) : (
                        realtimeVisitorsQuery.data.realtime.top_pages.map((page) => (
                          <div
                            key={page.path}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="font-mono text-primary truncate">{page.path}</span>
                            <span className="font-mono tabular-nums text-emerald-400 shrink-0">
                              {page.visitors}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="lg:col-span-2 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={visitorSearch}
                          onChange={(e) => setVisitorSearch(e.target.value)}
                          placeholder="Search active route, visitor ID, or device..."
                          aria-label="Search live visitors"
                          className="w-full h-8 pl-8 pr-7 rounded-lg bg-[#09090b] border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent"
                        />
                        {visitorSearch && (
                          <button
                            type="button"
                            onClick={() => setVisitorSearch("")}
                            aria-label="Clear visitor search"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="admin-table-shell overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
                          <tr>
                            <th className="px-4 py-3 font-medium">Visitor</th>
                            <th className="px-4 py-3 font-medium">Route</th>
                            <th className="px-4 py-3 font-medium">Session</th>
                            <th className="px-4 py-3 font-medium">Device</th>
                            <th className="px-4 py-3 font-medium">Last Seen</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {(() => {
                            const needle = visitorSearch.trim().toLowerCase();
                            const rows = (realtimeVisitorsQuery.data?.realtime.recent_visitors ?? []).filter((v) => {
                              if (!needle) return true;
                              return [v.visitor_id, v.path, v.device_type, v.authenticated ? "authenticated" : "public"].some(
                                (val) => val.toLowerCase().includes(needle)
                              );
                            });
                            if (!rows.length) {
                              return (
                                <tr>
                                  <td colSpan={5} className="px-4 py-6 text-center text-secondary">
                                    {needle ? "No active visitors match your search." : "No active visitors in the last 5 minutes."}
                                  </td>
                                </tr>
                              );
                            }
                            return rows.map((v) => (
                              <tr key={v.visitor_id} className="hover:bg-hover-surface/50 transition-colors">
                                <td className="px-4 py-2.5 font-mono text-[11px] text-primary">
                                  {v.visitor_id}
                                </td>
                                <td className="px-4 py-2.5 font-mono text-[11px] text-secondary truncate max-w-[220px]">
                                  {v.path}
                                </td>
                                <td className="px-4 py-2.5">
                                  <Badge>{v.authenticated ? "Authenticated" : "Public"}</Badge>
                                </td>
                                <td className="px-4 py-2.5 capitalize text-secondary">
                                  {v.device_type}
                                </td>
                                <td className="px-4 py-2.5 text-secondary whitespace-nowrap">
                                  {new Date(v.last_seen_at).toLocaleTimeString()}
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* 24h Traffic & Route Analytics */}
                <div className="pt-2 space-y-4 border-t border-subtle">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-medium text-primary">24-Hour Traffic & Route Analytics</h2>
                      <p className="text-xs text-secondary">
                        Rolling 24-hour in-app pageviews and unique visitor sessions (complements Vercel Web Analytics).
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="admin-kpi-card space-y-1.5">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
                        Pageviews (24h)
                      </span>
                      <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
                        <AnimatedNumber value={realtimeVisitorsQuery.data?.realtime.analytics_24h.total_pageviews ?? 0} />
                      </p>
                    </div>

                    <div className="admin-kpi-card space-y-1.5">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
                        Unique Visitors (24h)
                      </span>
                      <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
                        <AnimatedNumber value={realtimeVisitorsQuery.data?.realtime.analytics_24h.unique_visitors ?? 0} />
                      </p>
                    </div>

                    <div className="admin-kpi-card space-y-1.5">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
                        Authenticated Share
                      </span>
                      <p className="text-2xl font-heading font-semibold text-primary tabular-nums">
                        {realtimeVisitorsQuery.data?.realtime.analytics_24h.authenticated_share_pct ?? 0}%
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="admin-card p-5 lg:col-span-2 space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-medium text-primary">Hourly Traffic (24h)</h3>
                          <p className="text-[11px] text-secondary">Pageviews per hour over the last 24 hours</p>
                        </div>
                      </div>
                      {(() => {
                        const trend = realtimeVisitorsQuery.data?.realtime.analytics_24h.hourly_trend ?? [];
                        const maxViews = Math.max(1, ...trend.map((b) => b.pageviews));
                        return (
                          <div className="space-y-2">
                            <div className="h-32 flex items-end gap-1 pt-2">
                              {trend.map((bucket) => {
                                const heightPct = Math.max(
                                  bucket.pageviews > 0 ? 8 : 3,
                                  Math.round((bucket.pageviews / maxViews) * 100)
                                );
                                return (
                                  <div
                                    key={bucket.hour}
                                    title={`${bucket.label} · ${bucket.pageviews} views · ${bucket.unique_visitors} unique`}
                                    className="flex-1 flex flex-col items-center justify-end h-full group"
                                  >
                                    <div
                                      style={{ height: `${heightPct}%` }}
                                      className={`w-full rounded-t-sm transition-colors ${
                                        bucket.pageviews > 0
                                          ? "bg-emerald-500/60 group-hover:bg-emerald-400"
                                          : "bg-white/[0.06]"
                                      }`}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex justify-between text-[10px] font-mono text-muted">
                              <span>{trend[0]?.label ?? "24h ago"}</span>
                              <span>{trend[Math.floor(trend.length / 2)]?.label ?? ""}</span>
                              <span>{trend[trend.length - 1]?.label ?? "Now"}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="admin-table-shell overflow-hidden">
                      <div className="px-4 py-3 border-b border-subtle">
                        <h3 className="text-xs font-medium text-primary">Top Routes (24h)</h3>
                        <p className="text-[11px] text-secondary">Most visited routes in the last 24h</p>
                      </div>
                      <div className="divide-y divide-subtle">
                        {!realtimeVisitorsQuery.data?.realtime.analytics_24h.top_pages.length ? (
                          <div className="px-4 py-6 text-center text-xs text-secondary">
                            No route views recorded in the last 24 hours.
                          </div>
                        ) : (
                          realtimeVisitorsQuery.data.realtime.analytics_24h.top_pages.map((p) => (
                            <div key={p.path} className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs">
                              <span className="font-mono text-primary truncate">{p.path}</span>
                              <span className="font-mono text-[11px] text-secondary tabular-nums shrink-0">
                                {p.pageviews} views · {p.unique_visitors} uniq
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* SECURITY CENTER MODULE */}
            {/* SECURITY TELEMETRY SECTION */}
            {section === "security" && (
              <SecurityTelemetryModule
                overview={securityOverview}
                health={health}
                isLoading={securityOverviewQuery.isLoading}
                isError={securityOverviewQuery.isError}
                error={securityOverviewQuery.error}
                onRetry={() => void securityOverviewQuery.refetch()}
                securityDays={securityDays}
                onChangeDays={setSecurityDays}
                onInspectEvents={(cat) => {
                  setEventCategory(cat ?? "");
                  setEventPage(1);
                  selectSection("security-events");
                }}
                onInspectIncidents={() => {
                  selectSection("incidents");
                }}
                onEscalateBurst={(alert) => {
                  setSelectedAuditLog(null);
                  setSelectedSecurityEvent(null);
                  setSelectedIncident(null);
                  setNewIncidentTitle(
                    `Burst HTTP ${alert.http_status} (${alert.event_count}x) on ${alert.route}`
                  );
                  setNewIncidentCategory(alert.http_status === 403 ? "access_control" : "api_abuse");
                  setNewIncidentSeverity("high");
                  setNewIncidentNotes(
                    `Automated 15m burst alert: ${alert.actor_name || alert.actor_id || "Anonymous"} triggered ${alert.event_count} HTTP ${alert.http_status} events on ${alert.route}.`
                  );
                  setNewIncidentEventIds([]);
                  setNewIncidentOrgId(undefined);
                  setIsCreatingIncident(true);
                }}
              />
            )}

            {/* THREAT DETECTION SECTION */}
            {section === "threats" && (
              <ThreatDetectionModule
                  isSuperAdmin={isSuperAdmin}
                overview={threatOverviewQuery.data?.overview}
                isLoading={threatOverviewQuery.isLoading}
                isError={threatOverviewQuery.isError}
                error={threatOverviewQuery.error}
                onRetry={() => void threatOverviewQuery.refetch()}
                days={securityDays}
                onChangeDays={setSecurityDays}
                onReviewSource={openThreatSourcePanel}
                onReviewAccount={openThreatAccountPanel}
              />
            )}

            {/* BANI AI MONITORING SECTION */}
            {isAiSection && (
              <AIMonitoringModule
                activeTab={
                  section === "ai-workspaces"
                    ? "workspaces"
                    : section === "ai-errors"
                      ? "errors"
                      : "overview"
                }
                overview={aiOverviewQuery.data?.overview}
                workspaces={aiWorkspacesQuery.data?.workspaces ?? []}
                isLoading={aiOverviewQuery.isLoading || aiWorkspacesQuery.isLoading}
                isError={aiOverviewQuery.isError || aiWorkspacesQuery.isError}
                error={aiOverviewQuery.error ?? aiWorkspacesQuery.error}
                onRetry={() => {
                  void aiOverviewQuery.refetch();
                  void aiWorkspacesQuery.refetch();
                }}
                days={aiDays}
                onChangeDays={setAiDays}
                search={aiSearch}
                onChangeSearch={setAiSearch}
                isSuperAdmin={isSuperAdmin}
                isSavingQuota={aiQuotaMutation.isPending}
                onSaveQuota={async (payload) => {
                  await aiQuotaMutation.mutateAsync(payload);
                }}
              />
            )}

            {/* FINANCIAL OVERSIGHT MODULE */}
            {isFinancialSection && (
              <FinancialOversightModule
                activeTab={
                  section === "financial-compliance"
                    ? "compliance"
                    : section === "financial-anomalies"
                      ? "anomalies"
                      : "overview"
                }
                overview={financialOverviewQuery.data?.overview}
                anomalies={financialAnomaliesQuery.data?.anomalies ?? []}
                compliance={financialComplianceQuery.data?.compliance}
                isLoading={financialOverviewQuery.isLoading || financialAnomaliesQuery.isLoading}
                isError={financialOverviewQuery.isError || financialAnomaliesQuery.isError}
                error={financialOverviewQuery.error || financialAnomaliesQuery.error}
                onRetry={() => {
                  void financialOverviewQuery.refetch();
                  void financialAnomaliesQuery.refetch();
                  void financialComplianceQuery.refetch();
                }}
                onOpenFinancialAudit={() => {
                  setAuditFilter("budget");
                  selectSection("audit");
                }}
              />
            )}

            {/* USERS & ROLES SECTION */}
            {section === "users" && (
              <section className="space-y-4">
                {/* Compact Horizontal Role Distribution Bars */}
                <div className="admin-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-mono uppercase tracking-wider text-muted">
                      Global Role Distribution ({totalUsers} accounts)
                    </h2>
                    <span className="text-[11px] font-mono text-secondary tabular-nums">
                      {privilegedTotal} privileged ({privilegedPct}%)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Super Admin", count: superAdmins, color: "bg-rose-500" },
                      { label: "Admin", count: admins, color: "bg-amber-500" },
                      { label: "Standard User", count: standardUsers, color: "bg-emerald-500" },
                    ].map((tier) => {
                      const pct = totalUsers > 0 ? Math.round((tier.count / totalUsers) * 100) : 0;
                      return (
                        <div key={tier.label} className="space-y-1.5 rounded-xl border border-subtle bg-elevated/40 p-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-primary">{tier.label}</span>
                            <span className="font-mono text-secondary tabular-nums">
                              {tier.count} ({pct}%)
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                            <div
                              className={`h-full rounded-full ${tier.color} transition-all duration-300`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-3.5 h-3.5 text-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search users..."
                      className="w-full rounded-xl border border-subtle bg-elevated pl-8.5 pr-3 py-2 text-xs text-primary placeholder:text-muted hover:border-strong focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-border-subtle transition-colors"
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0">
                    <Select
                      value={roleFilter}
                      onValueChange={(val) => setRoleFilter(val as "" | PlatformRole)}
                      ariaLabel="Filter by global role"
                      selectSize="sm"
                      menuWidth="auto"
                      className="w-full sm:w-[144px]"
                      options={[
                        { value: "", label: "All Roles" },
                        { value: "super_admin", label: "Super Admin" },
                        { value: "admin", label: "Admin" },
                        { value: "user", label: "User" },
                      ]}
                    />
                    <Select
                      value={userStatusFilter}
                      onValueChange={(val) => setUserStatusFilter(val as "" | "active" | "suspended" | "online")}
                      ariaLabel="Filter by account status"
                      selectSize="sm"
                      menuWidth="auto"
                      className="w-full sm:w-[136px]"
                      options={[
                        { value: "", label: "All Statuses" },
                        { value: "online", label: "Online Now" },
                        { value: "active", label: "Active" },
                        { value: "suspended", label: "Suspended" },
                      ]}
                    />
                    {(userSearch || roleFilter || userStatusFilter) && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserSearch("");
                          setRoleFilter("");
                          setUserStatusFilter("");
                        }}
                        className="text-[11px] font-mono text-secondary hover:text-primary underline cursor-pointer shrink-0 self-start sm:self-center px-1"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {!isSuperAdmin && (
                  <p className="text-xs text-secondary rounded-xl border border-subtle bg-surface px-4 py-2.5">
                    You have <strong className="text-primary">admin</strong> read access. Only a{" "}
                    <strong className="text-primary">super_admin</strong> can promote or demote global user roles.
                  </p>
                )}

                <div className="admin-table-shell overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
                      <tr>
                        <th className="px-4 py-3 font-medium">User</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Session Status</th>
                        <th className="px-4 py-3 font-medium">Orgs</th>
                        <th className="px-4 py-3 font-medium">Joined</th>
                        <th className="px-4 py-3 font-medium">Global Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {usersQuery.isLoading ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                            Loading users...
                          </td>
                        </tr>
                      ) : usersQuery.data?.users.length ? (
                        usersQuery.data.users
                          .filter((u) => {
                            if (userStatusFilter === "online") return Boolean(u.is_online);
                            if (userStatusFilter === "active") return !u.suspended_at;
                            if (userStatusFilter === "suspended") return Boolean(u.suspended_at);
                            return true;
                          })
                          .map((u) => (
                          <tr
                            key={u.id}
                            onClick={() => openUserPanel(u)}
                            className={`transition-colors cursor-pointer ${
                              selectedUser?.id === u.id ? "bg-selected-surface" : "hover:bg-hover-surface/40"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-primary">{u.display_name || "Unnamed User"}</span>
                                {u.is_online && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                                    <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                                    Online
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-secondary">
                                {u.username ? `@${u.username} · ` : ""}{u.email || u.id}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {u.suspended_at ? (
                                <span className="inline-flex items-center rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-mono text-rose-400">
                                  Suspended
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-mono text-emerald-400">
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-secondary">
                              {u.session_status === "logged_in" ? "Logged in" :
                                u.session_status === "timed_out" ? "Session timed out" : "Logged out"}
                            </td>
                            <td className="px-4 py-3 text-secondary tabular-nums">{u.organization_count}</td>
                            <td className="px-4 py-3 text-secondary whitespace-nowrap">
                              {new Date(u.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              {isSuperAdmin ? (
                                <Select
                                  value={u.role}
                                  disabled={roleMutation.isPending}
                                  ariaLabel={`Global role for ${u.email || u.id}`}
                                  selectSize="sm"
                                  menuWidth="auto"
                                  align="right"
                                  onValueChange={(val) => {
                                    const nextRole = val as PlatformRole;
                                    if (nextRole !== u.role) {
                                      setPendingRoleChange({ user: u, nextRole });
                                    }
                                  }}
                                  options={[
                                    { value: "user", label: "user" },
                                    { value: "admin", label: "admin" },
                                    { value: "super_admin", label: "super_admin" },
                                  ]}
                                />
                              ) : (
                                <Badge>{u.role}</Badge>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                            No users found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ORGANIZATIONS SECTION */}
            {section === "organizations" && (
              <section className="space-y-4">
                {(() => {
                  const orgList = orgsQuery.data?.organizations ?? [];
                  const totalOrgs = orgList.length;
                  const activeOrgs = orgList.filter((o) => !o.suspended_at && !o.closed_at).length;
                  const closedOrgs = orgList.filter((o) => Boolean(o.closed_at)).length;
                  const suspendedOrgs = orgList.filter((o) => Boolean(o.suspended_at)).length;
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="admin-kpi-card">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Total Workspaces</p>
                        <p className="text-xl font-heading font-semibold text-primary tabular-nums mt-1">{totalOrgs}</p>
                      </div>
                      <div className="admin-kpi-card">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Active</p>
                        <p className="text-xl font-heading font-semibold text-emerald-400 tabular-nums mt-1">{activeOrgs}</p>
                      </div>
                      <div className="admin-kpi-card">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Closed</p>
                        <p className="text-xl font-heading font-semibold text-secondary tabular-nums mt-1">{closedOrgs}</p>
                      </div>
                      <div className="admin-kpi-card">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Restricted</p>
                        <p className="text-xl font-heading font-semibold text-rose-400 tabular-nums mt-1">{suspendedOrgs}</p>
                      </div>
                    </div>
                  );
                })()}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-3.5 h-3.5 text-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={orgSearch}
                      onChange={(e) => setOrgSearch(e.target.value)}
                      placeholder="Search organizations by name or ID..."
                      className="w-full rounded-xl border border-subtle bg-elevated pl-8.5 pr-3 py-2 text-xs text-primary placeholder:text-muted hover:border-strong focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-border-subtle transition-colors"
                    />
                  </div>
                  {orgSearch && (
                    <button
                      type="button"
                      onClick={() => setOrgSearch("")}
                      className="text-[11px] font-mono text-secondary hover:text-primary underline cursor-pointer shrink-0 self-start sm:self-center px-1"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="admin-table-shell overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Organization</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Creator / Owner</th>
                        <th className="px-4 py-3 font-medium">Currency / TZ</th>
                        <th className="px-4 py-3 font-medium">Members</th>
                        <th className="px-4 py-3 font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {orgsQuery.isLoading ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                            Loading organizations...
                          </td>
                        </tr>
                      ) : orgsQuery.data?.organizations.length ? (
                        orgsQuery.data.organizations.map((org) => (
                          <tr
                            key={org.id}
                            onClick={() => openOrgPanel(org)}
                            className={`transition-colors cursor-pointer ${
                              selectedOrg?.id === org.id ? "bg-selected-surface" : "hover:bg-hover-surface/40"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-medium text-primary">{org.name}</div>
                              <div className="text-[11px] font-mono text-muted capitalize">
                                {org.organization_type || "other"} · {org.id.slice(0, 8)}…
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {org.suspended_at ? (
                                <span className="inline-flex items-center rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-mono text-rose-400">
                                  Suspended
                                </span>
                              ) : org.closed_at ? (
                                <span className="inline-flex items-center rounded-md border border-subtle bg-elevated px-2 py-0.5 text-[11px] font-mono text-muted">
                                  Closed
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-mono text-emerald-400">
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-primary">
                                {org.creator_name || "Unnamed User"}
                              </div>
                              <div className="text-[11px] text-secondary">
                                {org.creator_email || org.creator_id || "—"}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-secondary">
                              {org.currency} · {org.time_zone || "UTC"}
                            </td>
                            <td className="px-4 py-3 text-secondary tabular-nums">{org.active_member_count}</td>
                            <td className="px-4 py-3 text-secondary whitespace-nowrap">
                              <div className="flex items-center justify-between gap-2">
                                <span>{new Date(org.created_at).toLocaleDateString()}</span>
                                <ArrowRight className="w-3.5 h-3.5 text-muted shrink-0" />
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                            No organizations found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* AUDIT LOGS SECTION */}
            {section === "audit" && (
              <section className="space-y-4">
                {/* AUDIT LOGS TABLE */}
                <div className="space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                      <div className="relative flex-1 min-w-0">
                        <Search className="w-3.5 h-3.5 text-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="search"
                          value={auditFilter}
                          onChange={(e) => {
                            setAuditFilter(e.target.value);
                            setAuditPage(1);
                          }}
                          placeholder={
                            auditViewMode === "developer"
                              ? "Search by action key, timestamp, actor, scope, or entity..."
                              : "Search by event, timestamp, actor, scope, or summary..."
                          }
                          className="w-full rounded-xl border border-subtle bg-elevated pl-8.5 pr-3 py-2 text-xs text-primary placeholder:text-muted hover:border-strong focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-border-subtle transition-colors"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
                        <div className="flex items-center gap-1.5 text-muted w-full sm:w-auto">
                          <span className="text-[11px] font-mono shrink-0">From</span>
                          <DatePicker
                            value={auditFrom}
                            onChange={(val) => {
                              setAuditFrom(val);
                              setAuditPage(1);
                            }}
                            placeholder="Start date"
                            size="sm"
                            className="w-full sm:w-[144px]"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 text-muted w-full sm:w-auto">
                          <span className="text-[11px] font-mono shrink-0">To</span>
                          <DatePicker
                            value={auditTo}
                            onChange={(val) => {
                              setAuditTo(val);
                              setAuditPage(1);
                            }}
                            placeholder="End date"
                            size="sm"
                            className="w-full sm:w-[144px]"
                            align="right"
                          />
                        </div>
                        {(auditFilter || auditFrom || auditTo) && (
                          <button
                            type="button"
                            onClick={() => {
                              setAuditFilter("");
                              setAuditFrom("");
                              setAuditTo("");
                              setAuditPage(1);
                            }}
                            className="text-[11px] font-mono text-secondary hover:text-primary underline cursor-pointer shrink-0 px-1"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    {auditQuery.isError && (
                      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
                        <span>{formatErrorMessage(auditQuery.error)}</span>
                        <button
                          type="button"
                          onClick={() => void auditQuery.refetch()}
                          className="font-medium underline cursor-pointer shrink-0"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    <div className="rounded-xl border border-subtle bg-surface px-4 py-2.5">
                      <EventSignificanceLegend />
                    </div>

                    <div className="admin-table-shell overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
                          <tr>
                            <th className="px-4 py-3 font-medium">Timestamp</th>
                            <th className="px-4 py-3 font-medium">
                              {auditViewMode === "developer" ? "Action Key" : "Event"}
                            </th>
                            <th className="px-4 py-3 font-medium">Actor</th>
                            <th className="px-4 py-3 font-medium">Scope</th>
                            <th className="px-4 py-3 font-medium">
                              {auditViewMode === "developer" ? "Entity ID" : "Summary"}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {auditQuery.isLoading ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-secondary">
                                Loading audit logs...
                              </td>
                            </tr>
                          ) : auditQuery.data?.logs.length ? (
                            auditQuery.data.logs.map((log) => (
                              <tr
                                key={log.id}
                                onClick={() => openAuditLogPanel(log)}
                                className={`transition-colors cursor-pointer ${
                                  selectedAuditLog?.id === log.id
                                    ? "bg-selected-surface"
                                    : "hover:bg-hover-surface/60"
                                }`}
                              >
                                <td className="px-4 py-3 text-secondary whitespace-nowrap">
                                  {new Date(log.occurred_at).toLocaleString()}
                                </td>
                                <td className="px-4 py-3">
                                  {renderAuditEventBadge(log.action, auditViewMode)}
                                </td>
                                <td className="px-4 py-3 text-secondary">
                                  {renderAuditActorBadge(log.actor_name, log.actor_role, log.actor_id, auditViewMode)}
                                </td>
                                <td className="px-4 py-3 text-secondary">
                                  {log.organization_name || "Platform"}
                                  {auditViewMode === "developer" && log.organization_id && (
                                    <div className="font-mono text-[11px] text-muted">{log.organization_id}</div>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={auditViewMode === "developer" ? "font-mono text-[11px] text-muted truncate max-w-[180px]" : "text-secondary truncate max-w-[220px]"}>
                                      {auditViewMode === "developer"
                                        ? log.entity_id
                                        : formatAuditChangeSummary(log.before_value, log.after_value)}
                                    </span>
                                    <ArrowRight className="w-3.5 h-3.5 text-muted shrink-0" />
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-secondary">
                                No audit logs found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <Pagination
                      currentPage={auditPage}
                      totalItems={auditQuery.data?.total ?? 0}
                      pageSize={auditPageSize}
                      onPageChange={setAuditPage}
                      pageSizeOptions={[25, 50, 100]}
                      onPageSizeChange={(size) => {
                        setAuditPageSize(size);
                        setAuditPage(1);
                      }}
                      itemLabel="audit logs"
                    />
                  </div>
              </section>
            )}

            {/* SECURITY EVENTS & OPERATIONAL MONITORING SECTIONS */}
            {(section === "security-events" || section === "operational") && (
              <section className="space-y-3">
                {section === "operational" && (
                  <div className="admin-card px-3.5 py-2 text-xs text-secondary flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate sm:whitespace-normal">
                        Tracks backend 5xx responses and dependency degradation separately from security threats.
                      </span>
                    </div>
                    <span
                      title="Identical errors within 5 minutes are grouped by signature. Requesting users are never penalized for server errors."
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-muted hover:text-secondary cursor-help shrink-0"
                    >
                      <Info className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">5m signature grouping</span>
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2.5 text-xs">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={eventSearch}
                      onChange={(e) => setEventSearch(e.target.value)}
                      placeholder={
                        section === "operational"
                          ? "Search route, error action, or request ID..."
                          : "Search action, actor, workspace, or route..."
                      }
                      aria-label="Search events"
                      className="w-full h-8 pl-8 pr-7 rounded-lg bg-[#09090b] border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent"
                    />
                    {eventSearch && (
                      <button
                        type="button"
                        onClick={() => setEventSearch("")}
                        aria-label="Clear event search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    {section === "security-events" && (
                      <Select
                        value={eventCategory}
                        onValueChange={(val) => {
                          setEventCategory(val as "" | SecurityCategory);
                          setEventPage(1);
                        }}
                        ariaLabel="Filter by security category"
                        selectSize="sm"
                        menuWidth="auto"
                        className="w-full sm:w-[172px]"
                        options={[
                          { value: "", label: "All Categories" },
                          { value: "auth", label: "Authentication" },
                          { value: "access_control", label: "Access Control" },
                          { value: "financial", label: "Financial Integrity" },
                          { value: "api_abuse", label: "API Abuse" },
                          { value: "data_protection", label: "Data Protection" },
                        ]}
                      />
                    )}

                    <Select
                      value={eventSeverity}
                      onValueChange={(val) => {
                        setEventSeverity(val as "" | SecuritySeverity);
                        setEventPage(1);
                      }}
                      ariaLabel="Filter by severity"
                      selectSize="sm"
                      menuWidth="auto"
                      className="w-full sm:w-[152px]"
                      options={[
                        { value: "", label: "All Severities" },
                        { value: "critical", label: "Critical" },
                        { value: "high", label: "High" },
                        { value: "medium", label: "Medium" },
                        { value: "low", label: "Low" },
                      ]}
                    />

                    <div className="flex items-center gap-1.5 text-muted w-full sm:w-auto">
                      <span className="text-[11px] font-mono shrink-0">From</span>
                      <DatePicker
                        value={auditFrom}
                        onChange={(val) => {
                          setAuditFrom(val);
                          setEventPage(1);
                        }}
                        placeholder="Start date"
                        size="sm"
                        className="w-full sm:w-[144px]"
                      />
                    </div>

                    <div className="flex items-center gap-1.5 text-muted w-full sm:w-auto">
                      <span className="text-[11px] font-mono shrink-0">To</span>
                      <DatePicker
                        value={auditTo}
                        onChange={(val) => {
                          setAuditTo(val);
                          setEventPage(1);
                        }}
                        placeholder="End date"
                        size="sm"
                        className="w-full sm:w-[144px]"
                        align="right"
                      />
                    </div>
                  </div>

                  {(eventSearch || eventCategory || eventSeverity || auditFrom || auditTo) && (
                    <button
                      type="button"
                      onClick={() => {
                        setEventSearch("");
                        setEventCategory("");
                        setEventSeverity("");
                        setAuditFrom("");
                        setAuditTo("");
                        setEventPage(1);
                      }}
                      className="text-[11px] font-mono text-secondary hover:text-primary underline cursor-pointer shrink-0 ml-auto"
                    >
                      Clear filters
                    </button>
                  )}
                </div>

                {securityEventsQuery.isError && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
                    <span>{formatErrorMessage(securityEventsQuery.error)}</span>
                    <button
                      type="button"
                      onClick={() => void securityEventsQuery.refetch()}
                      className="font-medium underline cursor-pointer shrink-0"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {section === "security-events" && (
                  <div className="admin-card px-3.5 py-2">
                    <EventSignificanceLegend />
                  </div>
                )}

                <div className="admin-table-shell overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
                          <tr>
                            <th className="px-4 py-3 font-medium">Timestamp</th>
                            <th className="px-4 py-3 font-medium">Severity</th>
                            <th className="px-4 py-3 font-medium">Category</th>
                            <th className="px-4 py-3 font-medium">Action / Route</th>
                            <th className="px-4 py-3 font-medium">Actor</th>
                            <th className="px-4 py-3 font-medium">Outcome</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {securityEventsQuery.isLoading ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                                Loading security events...
                              </td>
                            </tr>
                          ) : (() => {
                            const needle = eventSearch.trim().toLowerCase();
                            const filteredEvents = (securityEventsQuery.data?.events ?? []).filter((ev) => {
                              if (!needle) return true;
                              return [
                                ev.action,
                                ev.actor_name,
                                ev.actor_id,
                                ev.organization_name,
                                ev.route,
                                ev.request_id,
                                ev.category,
                                ev.outcome,
                                ev.http_status ? String(ev.http_status) : "",
                              ].some((val) => (val ?? "").toLowerCase().includes(needle));
                            });
                            if (!filteredEvents.length) {
                              return (
                                <tr>
                                  <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                                    {needle ? "No events match your search on this page." : "No security events found."}
                                  </td>
                                </tr>
                              );
                            }
                            return filteredEvents.map((ev) => (
                              <tr
                                key={ev.id}
                                onClick={() => openSecurityEventPanel(ev)}
                                className={`transition-colors cursor-pointer ${
                                  selectedSecurityEvent?.id === ev.id
                                    ? "bg-selected-surface"
                                    : "hover:bg-hover-surface/60"
                                }`}
                              >
                                <td className="px-4 py-3 text-secondary whitespace-nowrap">
                                  {new Date(ev.occurred_at).toLocaleString()}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono uppercase ${severityBadgeClass(ev.severity)}`}>
                                    {ev.severity}
                                  </span>
                                </td>
                                <td className="px-4 py-3 capitalize text-secondary">
                                  {ev.category.replace("_", " ")}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="font-mono text-[11px] text-primary">{ev.action}</div>
                                  {ev.route && (
                                    <div className="font-mono text-[11px] text-muted truncate max-w-[240px]">
                                      {ev.http_status ? `${ev.http_status} · ` : ""}
                                      {ev.route}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-secondary">
                                  {ev.actor_name || ev.actor_id || "Anonymous"}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <Badge>{ev.outcome}</Badge>
                                    <ArrowRight className="w-3.5 h-3.5 text-muted shrink-0" />
                                  </div>
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>

                    <Pagination
                      currentPage={eventPage}
                      totalItems={securityEventsQuery.data?.total ?? 0}
                      pageSize={eventPageSize}
                      onPageChange={setEventPage}
                      pageSizeOptions={[25, 50, 100]}
                      onPageSizeChange={(size) => {
                        setEventPageSize(size);
                        setEventPage(1);
                      }}
                      itemLabel="security events"
                    />
              </section>
            )}

            {/* INCIDENTS SECTION */}
            {section === "incidents" && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2.5 text-xs">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={incidentSearch}
                      onChange={(e) => setIncidentSearch(e.target.value)}
                      placeholder="Search incident title, category, or workspace..."
                      aria-label="Search incidents"
                      className="w-full h-8 pl-8 pr-7 rounded-lg bg-[#09090b] border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent"
                    />
                    {incidentSearch && (
                      <button
                        type="button"
                        onClick={() => setIncidentSearch("")}
                        aria-label="Clear incident search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    <Select
                      value={incidentStatus}
                      onValueChange={(val) => {
                        setIncidentStatus(val as "" | IncidentStatus);
                        setIncidentPage(1);
                      }}
                      ariaLabel="Filter by incident status"
                      selectSize="sm"
                      menuWidth="auto"
                      className="w-full sm:w-[160px]"
                      options={[
                        { value: "", label: "All Statuses" },
                        { value: "open", label: "Open" },
                        { value: "investigating", label: "Investigating" },
                        { value: "resolved", label: "Resolved" },
                        { value: "false_positive", label: "False Positive" },
                      ]}
                    />

                    <Select
                      value={incidentSeverity}
                      onValueChange={(val) => {
                        setIncidentSeverity(val as "" | SecuritySeverity);
                        setIncidentPage(1);
                      }}
                      ariaLabel="Filter by incident severity"
                      selectSize="sm"
                      menuWidth="auto"
                      className="w-full sm:w-[152px]"
                      options={[
                        { value: "", label: "All Severities" },
                        { value: "critical", label: "Critical" },
                        { value: "high", label: "High" },
                        { value: "medium", label: "Medium" },
                        { value: "low", label: "Low" },
                      ]}
                    />
                  </div>

                  <div className="flex items-center gap-2.5 ml-auto">
                    {(incidentSearch || incidentStatus || incidentSeverity) && (
                      <button
                        type="button"
                        onClick={() => {
                          setIncidentSearch("");
                          setIncidentStatus("");
                          setIncidentSeverity("");
                          setIncidentPage(1);
                        }}
                        className="text-[11px] font-mono text-secondary hover:text-primary underline cursor-pointer shrink-0"
                      >
                        Clear filters
                      </button>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => openNewIncidentForm()}
                      icon={<Plus className="w-3.5 h-3.5" />}
                    >
                      New Incident
                    </Button>
                  </div>
                </div>

                {securityIncidentsQuery.isError && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
                    <span>{formatErrorMessage(securityIncidentsQuery.error)}</span>
                    <button
                      type="button"
                      onClick={() => void securityIncidentsQuery.refetch()}
                      className="font-medium underline cursor-pointer shrink-0"
                    >
                      Retry
                    </button>
                  </div>
                )}

                <div className="admin-table-shell overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-subtle text-muted uppercase tracking-wider text-[11px]">
                          <tr>
                            <th className="px-4 py-3 font-medium">Incident</th>
                            <th className="px-4 py-3 font-medium">Severity</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3 font-medium">Category</th>
                            <th className="px-4 py-3 font-medium">Scope</th>
                            <th className="px-4 py-3 font-medium">Detected</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {securityIncidentsQuery.isLoading ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                                Loading incidents...
                              </td>
                            </tr>
                          ) : (() => {
                            const needle = incidentSearch.trim().toLowerCase();
                            const filteredIncidents = (securityIncidentsQuery.data?.incidents ?? []).filter((inc) => {
                              if (!needle) return true;
                              return [
                                inc.title,
                                inc.category,
                                inc.severity,
                                inc.status,
                                inc.organization_name,
                              ].some((val) => (val ?? "").toLowerCase().includes(needle));
                            });
                            if (!filteredIncidents.length) {
                              return (
                                <tr>
                                  <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                                    {needle ? "No incidents match your search on this page." : "No security incidents found."}
                                  </td>
                                </tr>
                              );
                            }
                            return filteredIncidents.map((inc) => (
                              <tr
                                key={inc.id}
                                onClick={() => openIncidentPanel(inc)}
                                className={`transition-colors cursor-pointer ${
                                  selectedIncident?.id === inc.id
                                    ? "bg-selected-surface"
                                    : "hover:bg-hover-surface/60"
                                }`}
                              >
                                <td className="px-4 py-3">
                                  <div className="font-medium text-primary">{inc.title}</div>
                                  <div className="text-[11px] font-mono text-muted">
                                    {inc.event_ids.length} linked event{inc.event_ids.length === 1 ? "" : "s"}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono uppercase ${severityBadgeClass(inc.severity)}`}>
                                    {inc.severity}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono capitalize ${incidentStatusBadgeClass(inc.status)}`}>
                                    {inc.status.replace("_", " ")}
                                  </span>
                                </td>
                                <td className="px-4 py-3 capitalize text-secondary">
                                  {inc.category.replace("_", " ")}
                                </td>
                                <td className="px-4 py-3 text-secondary">
                                  {inc.organization_name || "Platform"}
                                </td>
                                <td className="px-4 py-3 text-secondary whitespace-nowrap">
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{new Date(inc.detected_at).toLocaleString()}</span>
                                    <ArrowRight className="w-3.5 h-3.5 text-muted shrink-0" />
                                  </div>
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>

                    <Pagination
                      currentPage={incidentPage}
                      totalItems={securityIncidentsQuery.data?.total ?? 0}
                      pageSize={incidentPageSize}
                      onPageChange={setIncidentPage}
                      pageSizeOptions={[25, 50, 100]}
                      onPageSizeChange={(size) => {
                        setIncidentPageSize(size);
                        setIncidentPage(1);
                      }}
                      itemLabel="incidents"
                    />
              </section>
            )}
          </div>
        </main>

        {/* Docked Right-Side Detail Panel (smooth enter/exit slide, draggable resize on desktop) */}
        <aside
          aria-label="Event and Incident Details"
          aria-hidden={!hasRightPanel}
          inert={!hasRightPanel}
          style={{ "--right-panel-width": `${rightPanelWidth}px` } as React.CSSProperties}
          className={`relative shrink-0 workspace-sidebar-surface flex flex-col min-h-0 overflow-hidden motion-reduce:transition-none max-md:fixed max-md:inset-0 max-md:top-(--workspace-navbar-height) max-md:z-40 ${
            isResizingRightPanel ? "transition-none" : "transition-all duration-300 ease-out"
          } ${
            hasRightPanel
              ? "w-full md:w-(--right-panel-width) md:border-l border-subtle opacity-100 translate-x-0"
              : "w-0 md:w-0 md:border-l-0 border-transparent opacity-0 pointer-events-none max-md:translate-x-full"
          }`}
        >
          {hasRightPanel && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize detail panel"
                aria-valuemin={MIN_RIGHT_PANEL_WIDTH}
                aria-valuemax={MAX_RIGHT_PANEL_WIDTH}
                aria-valuenow={rightPanelWidth}
                title="Drag to resize · Double-click to reset"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setIsResizingRightPanel(true);
                }}
                onDoubleClick={resetRightPanelWidth}
                className="hidden md:flex absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 z-30 cursor-col-resize items-center justify-center group"
              >
                <span
                  className={`w-[3px] h-12 rounded-full transition-colors ${
                    isResizingRightPanel
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                      : "bg-white/10 group-hover:bg-white/35"
                  }`}
                />
              </div>

              <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-b border-subtle bg-white/[0.02] text-[10px] font-mono text-muted shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      isResizingRightPanel ? "bg-emerald-400" : "bg-white/25"
                    }`}
                  />
                  Inspector · {rightPanelWidth}px
                </span>
                <button
                  type="button"
                  onClick={resetRightPanelWidth}
                  disabled={rightPanelWidth === DEFAULT_RIGHT_PANEL_WIDTH}
                  title={`Reset to default width (${DEFAULT_RIGHT_PANEL_WIDTH}px)`}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono text-secondary hover:text-primary hover:bg-hover-surface disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reset width
                </button>
              </div>
            </>
          )}
          {selectedAuditLog && (
            <div className="w-full flex flex-col flex-1 min-h-0">
              <div className="px-5 py-3.5 border-b border-subtle flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Audit Event Details
                  </p>
                  <h2 className="text-sm font-heading font-medium text-primary truncate">
                    {auditViewMode === "developer"
                      ? selectedAuditLog.action
                      : formatAuditActionLabel(selectedAuditLog.action)}
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="inline-flex rounded-lg border border-subtle bg-elevated p-0.5 text-[11px]" role="group" aria-label="Detail view mode">
                    <button
                      type="button"
                      onClick={() => toggleAuditViewMode("normal")}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                        auditViewMode === "normal"
                          ? "bg-selected-surface text-primary shadow-xs"
                          : "text-secondary hover:text-primary"
                      }`}
                    >
                      <Eye className="w-3 h-3" />
                      Normal
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleAuditViewMode("developer")}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                        auditViewMode === "developer"
                          ? "bg-selected-surface text-primary shadow-xs"
                          : "text-secondary hover:text-primary"
                      }`}
                    >
                      <Code2 className="w-3 h-3" />
                      Dev
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={closeRightPanel}
                    aria-label="Close details panel"
                    className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Timestamp</p>
                    <p className="text-primary font-medium">
                      {new Date(selectedAuditLog.occurred_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Scope</p>
                    <p className="text-primary font-medium">
                      {selectedAuditLog.organization_name || "Platform"}
                    </p>
                    {auditViewMode === "developer" && selectedAuditLog.organization_id && (
                      <p className="font-mono text-[10px] text-muted break-all">
                        {selectedAuditLog.organization_id}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Actor</p>
                    <p className="text-primary font-medium">
                      {selectedAuditLog.actor_name || "System"}
                    </p>
                    {auditViewMode === "developer" && selectedAuditLog.actor_id && (
                      <p className="font-mono text-[10px] text-muted break-all">
                        {selectedAuditLog.actor_id}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      {auditViewMode === "developer" ? "Entity ID" : "Event Type"}
                    </p>
                    <p className={auditViewMode === "developer" ? "font-mono text-[11px] text-primary break-all" : "text-primary font-medium"}>
                      {auditViewMode === "developer"
                        ? selectedAuditLog.entity_id
                        : formatAuditActionLabel(selectedAuditLog.action)}
                    </p>
                  </div>
                </div>

                {auditViewMode === "developer" ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-muted">
                        Before Value
                      </p>
                      <pre className="rounded-xl border border-subtle bg-surface p-3 font-mono text-[11px] text-secondary overflow-x-auto">
                        {selectedAuditLog.before_value
                          ? JSON.stringify(selectedAuditLog.before_value, null, 2)
                          : "null"}
                      </pre>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-muted">
                        After Value
                      </p>
                      <pre className="rounded-xl border border-subtle bg-surface p-3 font-mono text-[11px] text-primary overflow-x-auto">
                        {selectedAuditLog.after_value
                          ? JSON.stringify(selectedAuditLog.after_value, null, 2)
                          : "null"}
                      </pre>
                    </div>
                    <p className="text-[11px] font-mono text-muted">
                      Audit Log ID: #{selectedAuditLog.id}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-subtle bg-surface p-4 space-y-2">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      Change Summary
                    </p>
                    <p className="text-sm text-primary leading-relaxed">
                      {formatAuditChangeSummary(
                        selectedAuditLog.before_value,
                        selectedAuditLog.after_value
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedSecurityEvent && (
            <div className="w-full flex flex-col flex-1 min-h-0">
              <div className="px-5 py-3.5 border-b border-subtle flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Immutable Security Event #{selectedSecurityEvent.id}
                  </p>
                  <h2 className="text-sm font-heading font-medium text-primary truncate font-mono">
                    {selectedSecurityEvent.action}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeRightPanel}
                  aria-label="Close security event panel"
                  className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono uppercase ${severityBadgeClass(selectedSecurityEvent.severity)}`}>
                    {selectedSecurityEvent.severity}
                  </span>
                  <Badge>{selectedSecurityEvent.category.replace("_", " ")}</Badge>
                  <Badge>{selectedSecurityEvent.outcome}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Occurred At</p>
                    <p className="text-primary font-medium">
                      {new Date(selectedSecurityEvent.occurred_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">HTTP Status</p>
                    <p className="font-mono text-primary font-medium">
                      {selectedSecurityEvent.http_status ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Requesting User</p>
                    <p className="text-primary font-medium">
                      {selectedSecurityEvent.requesting_user_name || selectedSecurityEvent.actor_name || "Anonymous"}
                    </p>
                    {(selectedSecurityEvent.requesting_user_id || selectedSecurityEvent.actor_id) && (
                      <p className="font-mono text-[10px] text-muted break-all">
                        {selectedSecurityEvent.requesting_user_id || selectedSecurityEvent.actor_id}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Event Source</p>
                    <p className="font-mono text-primary font-medium capitalize">
                      {selectedSecurityEvent.event_source || "api"}
                    </p>
                    <p className="text-[10px] font-mono text-muted">
                      Occurrences: {selectedSecurityEvent.occurrence_count ?? 1}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Enforcement Eligible</p>
                    <p className={selectedSecurityEvent.enforcement_eligible ? "text-amber-400 font-medium" : "text-emerald-400 font-medium"}>
                      {selectedSecurityEvent.enforcement_eligible ? "Yes (Security Signal)" : "No (Operational / Audit)"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Request ID</p>
                    <p className="font-mono text-[10px] text-primary break-all">
                      {selectedSecurityEvent.request_id || "—"}
                    </p>
                  </div>
                </div>

                {selectedSecurityEvent.classification_reason && (
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Classification Reason</p>
                    <p className="text-xs text-primary">{selectedSecurityEvent.classification_reason}</p>
                  </div>
                )}

                {selectedSecurityEvent.route && (
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Route</p>
                    <p className="font-mono text-[11px] text-primary break-all">
                      {selectedSecurityEvent.route}
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-muted">Metadata</p>
                  <pre className="rounded-xl border border-subtle bg-surface p-3 font-mono text-[11px] text-secondary overflow-x-auto">
                    {JSON.stringify(selectedSecurityEvent.metadata ?? {}, null, 2)}
                  </pre>
                </div>

                <div className="pt-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    onClick={() => openNewIncidentForm(selectedSecurityEvent)}
                    icon={<AlertTriangle className="w-3.5 h-3.5" />}
                  >
                    Escalate to Incident
                  </Button>
                </div>
              </div>
            </div>
          )}

          {selectedIncident && (
            <div className="w-full flex flex-col flex-1 min-h-0">
              <div className="px-5 py-3.5 border-b border-subtle flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Incident Investigation
                  </p>
                  <h2 className="text-sm font-heading font-medium text-primary truncate">
                    {selectedIncident.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeRightPanel}
                  aria-label="Close incident panel"
                  className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono uppercase ${severityBadgeClass(selectedIncident.severity)}`}>
                    {selectedIncident.severity}
                  </span>
                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono capitalize ${incidentStatusBadgeClass(selectedIncident.status)}`}>
                    {selectedIncident.status.replace("_", " ")}
                  </span>
                  <Badge>{selectedIncident.category.replace("_", " ")}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Detected</p>
                    <p className="text-primary font-medium">
                      {new Date(selectedIncident.detected_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Scope</p>
                    <p className="text-primary font-medium">
                      {selectedIncident.organization_name || "Platform"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Assignee</p>
                    <p className="text-primary font-medium">
                      {selectedIncident.assigned_to_name || "Unassigned"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Linked Events</p>
                    <p className="font-mono text-primary font-medium">
                      {selectedIncident.event_ids.length > 0
                        ? selectedIncident.event_ids.map((id) => `#${id}`).join(", ")
                        : "None"}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                    Resolution Notes
                  </label>
                  <textarea
                    rows={4}
                    value={triageNotes}
                    onChange={(e) => setTriageNotes(e.target.value)}
                    placeholder="Document investigation findings, remediation steps, or false-positive rationale..."
                    className="w-full rounded-xl border border-subtle bg-surface p-3 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong"
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-muted">
                    Transition Status
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { status: "investigating", label: "Investigating" },
                        { status: "resolved", label: "Resolve" },
                        { status: "false_positive", label: "False Positive" },
                        { status: "open", label: "Reopen" },
                      ] as const
                    ).map((opt) => (
                      <Button
                        key={opt.status}
                        variant={opt.status === "resolved" ? "primary" : "secondary"}
                        size="sm"
                        disabled={
                          updateIncidentMutation.isPending ||
                          selectedIncident.status === opt.status
                        }
                        onClick={() =>
                          setPendingAdminAction({
                            kind: "incident_status",
                            incident: selectedIncident,
                            nextStatus: opt.status,
                            resolutionNotes: triageNotes.trim() || undefined,
                          })
                        }
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedUser && (
            <div className="w-full flex flex-col flex-1 min-h-0">
              <div className="px-5 py-3.5 border-b border-subtle flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Account Details & Restrictions
                  </p>
                  <h2 className="text-sm font-heading font-medium text-primary truncate">
                    {selectedUser.display_name || selectedUser.email || selectedUser.id}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeRightPanel}
                  aria-label="Close user panel"
                  className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Status</p>
                    <p className={selectedUser.suspended_at ? "text-rose-400 font-medium" : "text-emerald-400 font-medium"}>
                      {selectedUser.suspended_at ? "Suspended" : "Active"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Global Role</p>
                    <p className="font-mono text-primary font-medium">{selectedUser.role}</p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Workspaces</p>
                    <p className="text-primary font-medium tabular-nums">{selectedUser.organization_count}</p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Joined</p>
                    <p className="text-primary font-medium">
                      {new Date(selectedUser.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Account ID</p>
                  <p className="font-mono text-[11px] text-secondary break-all">{selectedUser.id}</p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                    Restriction Reason (Required for Suspension)
                  </label>
                  <textarea
                    rows={3}
                    value={suspensionReason}
                    onChange={(e) => setSuspensionReason(e.target.value)}
                    placeholder="Document policy violation or review reason..."
                    className="w-full rounded-xl border border-subtle bg-surface p-3 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong"
                  />
                </div>

                <div className="pt-1">
                  {selectedUser.suspended_at ? (
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      disabled={userSuspensionMutation.isPending}
                      onClick={() =>
                        setPendingAdminAction({
                          kind: "user_suspension",
                          target: selectedUser,
                          suspended: false,
                          reason: suspensionReason.trim() || "Restored by platform admin",
                        })
                      }
                    >
                      {userSuspensionMutation.isPending ? "Restoring..." : "Restore Account"}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                      disabled={userSuspensionMutation.isPending || selectedUser.id === user?.id}
                      onClick={() => {
                        if (suspensionReason.trim().length < 3) {
                          toast.error("Please provide a suspension reason (at least 3 characters).");
                          return;
                        }
                        setPendingAdminAction({
                          kind: "user_suspension",
                          target: selectedUser,
                          suspended: true,
                          reason: suspensionReason.trim(),
                        });
                      }}
                    >
                      {userSuspensionMutation.isPending ? "Suspending..." : "Suspend Account"}
                    </Button>
                  )}
                </div>

                {/* Workspace Memberships, Privilege Timeline & Security History */}
                <div className="space-y-3 pt-2 border-t border-subtle">
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-2">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      Workspace Memberships ({userDetailsQuery.data?.details.memberships.length ?? 0})
                    </p>
                    {userDetailsQuery.isLoading ? (
                      <p className="text-[11px] text-secondary">Loading memberships...</p>
                    ) : userDetailsQuery.data?.details.memberships.length ? (
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {userDetailsQuery.data.details.memberships.map((m) => (
                          <div key={m.organization_id} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-primary truncate">{m.organization_name}</span>
                            <span className="font-mono text-muted capitalize shrink-0">{m.workspace_role}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-secondary">No workspace memberships.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-2">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      Privilege & Role History
                    </p>
                    {userDetailsQuery.data?.details.role_history.length ? (
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {userDetailsQuery.data.details.role_history.map((r) => (
                          <div key={r.id} className="text-[11px] flex items-center justify-between gap-2">
                            <span className="font-mono text-primary truncate">{r.action}</span>
                            <span className="text-muted shrink-0">{new Date(r.created_at).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-secondary">No recent role changes.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-2">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      Account Security & Enforcement ({userDetailsQuery.data?.details.security_history.length ?? 0})
                    </p>
                    {userDetailsQuery.data?.details.security_history.length ? (
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {userDetailsQuery.data.details.security_history.slice(0, 8).map((ev) => (
                          <div key={ev.id} className="text-[11px] flex items-center justify-between gap-2">
                            <span className="font-mono text-amber-400 truncate">{ev.event_type}</span>
                            <span className="text-muted shrink-0">{new Date(ev.occurred_at).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-secondary">No recent security events for this user.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedOrg && (
            <div className="w-full flex flex-col flex-1 min-h-0">
              <div className="px-5 py-3.5 border-b border-subtle flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Workspace 360°
                  </p>
                  <h2 className="text-sm font-heading font-medium text-primary truncate">
                    {selectedOrg.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeRightPanel}
                  aria-label="Close workspace panel"
                  className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Workspace 360° Sub-tabs */}
              <div className="px-5 py-2.5 border-b border-subtle flex items-center gap-1 overflow-x-auto">
                {(
                  [
                    { id: "overview", label: "Overview" },
                    { id: "activity", label: "Activity" },
                    { id: "ai", label: "Bani Usage" },
                    { id: "financial", label: "Financial" },
                    { id: "security", label: "Security" },
                    { id: "audit", label: "Audit" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setOrgDrawerTab(tab.id)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer shrink-0 ${
                      orgDrawerTab === tab.id
                        ? "bg-selected-surface text-primary shadow-xs"
                        : "text-secondary hover:text-primary"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                {orgDrawerTab === "overview" && (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Status</p>
                        <p className={selectedOrg.suspended_at ? "text-rose-400 font-medium" : selectedOrg.closed_at ? "text-muted font-medium" : "text-emerald-400 font-medium"}>
                          {selectedOrg.suspended_at ? "Suspended" : selectedOrg.closed_at ? "Closed" : "Active"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Active Members</p>
                        <p className="text-primary font-medium tabular-nums">{selectedOrg.active_member_count}</p>
                      </div>
                      <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Open Incidents</p>
                        <p className="text-primary font-medium tabular-nums">{selectedOrg.open_incidents_count ?? 0}</p>
                      </div>
                      <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Pending Approvals</p>
                        <p className="text-primary font-medium tabular-nums">{selectedOrg.pending_approvals_count ?? 0}</p>
                      </div>
                    </div>

                    {workspace360Query.data?.workspace360.role_distribution.length ? (
                      <div className="rounded-xl border border-subtle bg-surface p-3 space-y-2">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                          Workspace Role Breakdown
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {workspace360Query.data.workspace360.role_distribution.map((r) => (
                            <span
                              key={r.role}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-elevated/50 px-2.5 py-1 text-[11px] font-mono"
                            >
                              <span className="capitalize text-secondary">{r.role}:</span>
                              <span className="text-primary font-semibold tabular-nums">{r.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Owner / Creator</p>
                      <p className="text-primary font-medium">{selectedOrg.creator_name || "Unnamed User"}</p>
                      <p className="text-[11px] text-secondary">{selectedOrg.creator_email || selectedOrg.creator_id || "—"}</p>
                    </div>

                    <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Workspace ID</p>
                      <p className="font-mono text-[11px] text-secondary break-all">{selectedOrg.id}</p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                        Restriction Reason (Required for Suspension)
                      </label>
                      <textarea
                        rows={3}
                        value={suspensionReason}
                        onChange={(e) => setSuspensionReason(e.target.value)}
                        placeholder="Document compliance or security reason..."
                        className="w-full rounded-xl border border-subtle bg-surface p-3 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong"
                      />
                    </div>

                    <div className="pt-1">
                      {selectedOrg.suspended_at ? (
                        <Button
                          variant="primary"
                          size="sm"
                          className="w-full"
                          disabled={orgSuspensionMutation.isPending}
                          onClick={() =>
                            setPendingAdminAction({
                              kind: "org_suspension",
                              target: selectedOrg,
                              suspended: false,
                              reason: suspensionReason.trim() || "Restored by platform admin",
                            })
                          }
                        >
                          {orgSuspensionMutation.isPending ? "Restoring..." : "Restore Workspace"}
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                          disabled={orgSuspensionMutation.isPending}
                          onClick={() => {
                            if (suspensionReason.trim().length < 3) {
                              toast.error("Please provide a suspension reason (at least 3 characters).");
                              return;
                            }
                            setPendingAdminAction({
                              kind: "org_suspension",
                              target: selectedOrg,
                              suspended: true,
                              reason: suspensionReason.trim(),
                            });
                          }}
                        >
                          {orgSuspensionMutation.isPending ? "Suspending..." : "Suspend Workspace"}
                        </Button>
                      )}
                    </div>
                  </>
                )}

                {orgDrawerTab === "activity" && (
                  org360ExtendedQuery.isLoading ? (
                    <p className="text-center text-secondary py-6">Loading workspace activity...</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-subtle bg-surface p-3 text-[11px] text-secondary">
                        Daily audit events and Bani AI requests across the last 30 days.
                      </div>
                      <SecurityTrendLineChart
                        data={(org360ExtendedQuery.data?.extended.activity_series ?? []).map((pt) => ({
                          day: pt.date,
                          total: pt.audit_events,
                          high_critical: pt.ai_requests,
                        }))}
                        height={150}
                        primaryLabel="Audit Events"
                        secondaryLabel="Bani Requests"
                        primaryColor="#10b981"
                        secondaryColor="#38bdf8"
                        emptyMessage="No workspace activity in the last 30 days."
                      />
                    </div>
                  )
                )}

                {orgDrawerTab === "ai" && (
                  org360ExtendedQuery.isLoading ? (
                    <p className="text-center text-secondary py-6">Loading Bani AI usage...</p>
                  ) : org360ExtendedQuery.data?.extended.ai_summary ? (
                    (() => {
                      const ai = org360ExtendedQuery.data.extended.ai_summary;
                      return (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Bani Status</p>
                              <p className={`text-sm font-semibold mt-1 ${ai.ai_enabled ? "text-emerald-400" : "text-rose-400"}`}>
                                {ai.ai_enabled ? "Enabled" : "Disabled"}
                              </p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">30d Requests</p>
                              <p className="text-sm font-semibold tabular-nums text-primary mt-1">{ai.period_requests}</p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Daily Quota</p>
                              <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-1">
                                {ai.daily_requests_used} / {ai.daily_request_limit === 0 ? "∞" : ai.daily_request_limit}
                              </p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Monthly Tokens</p>
                              <p className="text-sm font-semibold font-mono tabular-nums text-primary mt-1">
                                {ai.monthly_tokens_used.toLocaleString()} / {ai.monthly_token_limit === 0 ? "∞" : ai.monthly_token_limit.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Avg Latency</p>
                              <p className="text-sm font-semibold tabular-nums text-primary mt-1">{ai.avg_latency_ms} ms</p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Errors / Throttled</p>
                              <p className="text-sm font-semibold tabular-nums text-amber-400 mt-1">
                                {ai.period_errors} / {ai.period_rate_limited}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setAiSearch(selectedOrg.name);
                              selectSection("ai");
                              closeRightPanel();
                            }}
                            className="w-full rounded-xl border border-subtle bg-elevated py-2 text-xs font-medium text-primary hover:bg-hover-surface cursor-pointer"
                          >
                            Manage AI Quota in AI Monitoring →
                          </button>
                        </div>
                      );
                    })()
                  ) : (
                    <p className="text-center text-secondary py-6">No Bani AI telemetry available.</p>
                  )
                )}

                {orgDrawerTab === "financial" && (
                  workspace360Query.isLoading ? (
                    <p className="text-center text-secondary py-6">Loading financial summary...</p>
                  ) : workspace360Query.data?.workspace360.financial_summary ? (
                    (() => {
                      const fin = workspace360Query.data.workspace360.financial_summary;
                      const finCurrency = fin.currency || "PHP";
                      return (
                        <div className="space-y-3">
                          <div className="rounded-xl border border-subtle bg-surface p-3 text-[11px] text-secondary">
                            Aggregate ledger totals in <strong className="text-primary">{fin.currency}</strong> (privacy-preserving; no private line items).
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Collected</p>
                              <p className="text-sm font-semibold tabular-nums text-emerald-400 mt-1">
                                <CompactAmount centavos={fin.collected_centavos} currency={finCurrency} />
                              </p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Active Budgets</p>
                              <p className="text-sm font-semibold tabular-nums text-primary mt-1">
                                <CompactAmount centavos={fin.budget_allocated_centavos} currency={finCurrency} />
                              </p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Approved Expenses</p>
                              <p className="text-sm font-semibold tabular-nums text-primary mt-1">
                                <CompactAmount centavos={fin.approved_expenses_centavos} currency={finCurrency} />
                              </p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Open Advances</p>
                              <p className="text-sm font-semibold tabular-nums text-amber-400 mt-1">
                                <CompactAmount centavos={fin.open_advances_centavos} currency={finCurrency} />
                              </p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Pending Approvals</p>
                              <p className="text-sm font-semibold tabular-nums text-primary mt-1">
                                {fin.pending_approvals_count}
                              </p>
                            </div>
                            <div className="rounded-xl border border-subtle bg-surface p-3">
                              <p className="text-[10px] font-mono uppercase text-muted">Disputed Advances</p>
                              <p className={`text-sm font-semibold tabular-nums mt-1 ${fin.disputed_advances_count > 0 ? "text-rose-400" : "text-primary"}`}>
                                {fin.disputed_advances_count}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <p className="text-center text-secondary py-6">No financial summary available.</p>
                  )
                )}

                {orgDrawerTab === "security" && (
                  workspace360Query.isLoading ? (
                    <p className="text-center text-secondary py-6">Loading security incidents...</p>
                  ) : workspace360Query.data?.workspace360.incidents.length ? (
                    <ul className="space-y-2">
                      {workspace360Query.data.workspace360.incidents.map((inc) => (
                        <li key={inc.id} className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-primary truncate">{inc.title}</span>
                            <span className="font-mono text-[10px] uppercase text-amber-400 shrink-0">
                              {inc.severity}
                            </span>
                          </div>
                          <p className="text-[11px] text-secondary">
                            {inc.category.replace("_", " ")} · {inc.status} · {new Date(inc.created_at).toLocaleDateString()}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-center text-secondary py-6">No security incidents recorded for this workspace.</p>
                  )
                )}

                {orgDrawerTab === "audit" && (
                  workspace360Query.isLoading ? (
                    <p className="text-center text-secondary py-6">Loading workspace audit trail...</p>
                  ) : workspace360Query.data?.workspace360.recent_audit_logs.length ? (
                    <ul className="space-y-2">
                      {workspace360Query.data.workspace360.recent_audit_logs.map((log) => (
                        <li key={log.id} className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                          <p className="font-medium text-primary">{formatAuditActionLabel(log.action)}</p>
                          <p className="text-[11px] font-mono text-secondary">
                            {log.target_type} · {new Date(log.occurred_at).toLocaleString()}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-center text-secondary py-6">No recent audit logs for this workspace.</p>
                  )
                )}
              </div>
            </div>
          )}

          {selectedThreatSource && (
            <div className="w-full flex flex-col flex-1 min-h-0">
              <div className="px-5 py-3.5 border-b border-subtle flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Suspicious Source Enforcement
                  </p>
                  <h2 className="text-sm font-mono font-medium text-primary truncate">
                    {selectedThreatSource.source_ip}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeRightPanel}
                  aria-label="Close threat source panel"
                  className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase text-muted">Attempts</p>
                    <p className="text-base font-semibold tabular-nums text-primary">
                      {selectedThreatSource.attempts}
                    </p>
                  </div>
                  <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                    <p className="text-[10px] font-mono uppercase text-muted">Risk Score</p>
                    <p className="text-base font-semibold tabular-nums text-amber-400">
                      {selectedThreatSource.risk_score} ({selectedThreatSource.risk_level})
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                  <p className="text-[10px] font-mono uppercase text-muted">Current Restriction Status</p>
                  <p className="font-medium text-primary capitalize">
                    {selectedThreatSource.restriction_status}
                  </p>
                  {selectedThreatSource.expires_at && (
                    <p className="text-[11px] text-secondary">
                      Expires {new Date(selectedThreatSource.expires_at).toLocaleString()}
                    </p>
                  )}
                  {selectedThreatSource.reason && (
                    <p className="text-[11px] text-secondary pt-1">{selectedThreatSource.reason}</p>
                  )}
                </div>

                <div className="rounded-xl border border-subtle bg-surface p-4 space-y-3">
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                    Take Action
                  </label>
                  <Select
                    value={enforceActionType}
                    onValueChange={(val) => setEnforceActionType(val as EnforcementActionType)}
                    ariaLabel="Take action on source IP"
                    selectSize="sm"
                    options={[
                      { value: "monitor", label: "Monitor Source" },
                      { value: "temp_ip_block", label: "Temporary IP Block" },
                      { value: "remove_restriction", label: "Remove Restriction" },
                    ]}
                  />

                  {enforceActionType === "temp_ip_block" && (
                    <div className="space-y-1">
                      <label className="block text-[11px] text-secondary">Block Duration</label>
                      <Select
                        value={enforceDurationMinutes}
                        onValueChange={(val) => setEnforceDurationMinutes(Number(val))}
                        ariaLabel="IP block duration"
                        selectSize="sm"
                        options={[
                          { value: 15, label: "15 minutes" },
                          { value: 60, label: "1 hour" },
                          { value: 360, label: "6 hours" },
                          { value: 1440, label: "24 hours" },
                        ]}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="block text-[11px] text-secondary">
                      Enforcement Reason (Required)
                    </label>
                    <textarea
                      rows={3}
                      value={enforceReason}
                      onChange={(e) => setEnforceReason(e.target.value)}
                      placeholder="Document evidence and reason for this enforcement action..."
                      className="w-full rounded-xl border border-subtle bg-elevated p-2.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong"
                    />
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    disabled={enforceMutation.isPending}
                    onClick={() => {
                      if (enforceReason.trim().length < 3) {
                        toast.error("Please provide an enforcement reason (at least 3 characters).");
                        return;
                      }
                      setPendingAdminAction({
                        kind: "enforce_action",
                        actionType: enforceActionType,
                        reason: enforceReason.trim(),
                        targetIp: selectedThreatSource.source_ip,
                        targetLabel: selectedThreatSource.source_ip,
                        durationMinutes: enforceActionType === "temp_ip_block" ? enforceDurationMinutes : undefined,
                      });
                    }}
                  >
                    Apply Action
                  </Button>
                </div>
              </div>
            </div>
          )}

          {selectedThreatAccount && (
            <div className="w-full flex flex-col flex-1 min-h-0">
              <div className="px-5 py-3.5 border-b border-subtle flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Account Enforcement Controls
                  </p>
                  <h2 className="text-sm font-heading font-medium text-primary truncate">
                    {selectedThreatAccount.display_name || selectedThreatAccount.email || selectedThreatAccount.user_id}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeRightPanel}
                  aria-label="Close account enforcement panel"
                  className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                <div className="rounded-xl border border-subtle bg-surface p-3 space-y-1">
                  <p className="text-[10px] font-mono uppercase text-muted">Account ID</p>
                  <p className="font-mono text-[11px] text-secondary break-all">{selectedThreatAccount.user_id}</p>
                </div>

                <div className="rounded-xl border border-subtle bg-surface p-4 space-y-3">
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                    Take Action
                  </label>
                  <Select
                    value={enforceActionType}
                    onValueChange={(val) => setEnforceActionType(val as EnforcementActionType)}
                    ariaLabel="Take action on account"
                    selectSize="sm"
                    options={[
                      { value: "temp_account_lock", label: "Temporary Account Lock" },
                      { value: "revoke_sessions", label: "Revoke Active Sessions" },
                      { value: "suspend_account", label: "Suspend Account" },
                      { value: "remove_restriction", label: "Remove Restriction" },
                    ]}
                  />

                  {enforceActionType === "temp_account_lock" && (
                    <div className="space-y-1">
                      <label className="block text-[11px] text-secondary">Lock Duration</label>
                      <Select
                        value={enforceDurationMinutes}
                        onValueChange={(val) => setEnforceDurationMinutes(Number(val))}
                        ariaLabel="Account lock duration"
                        selectSize="sm"
                        options={[
                          { value: 15, label: "15 minutes" },
                          { value: 60, label: "1 hour" },
                          { value: 360, label: "6 hours" },
                          { value: 1440, label: "24 hours" },
                        ]}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="block text-[11px] text-secondary">
                      Enforcement Reason (Required)
                    </label>
                    <textarea
                      rows={3}
                      value={enforceReason}
                      onChange={(e) => setEnforceReason(e.target.value)}
                      placeholder="Document justification for this enforcement action..."
                      className="w-full rounded-xl border border-subtle bg-elevated p-2.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong"
                    />
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    disabled={enforceMutation.isPending}
                    onClick={() => {
                      if (enforceReason.trim().length < 3) {
                        toast.error("Please provide an enforcement reason (at least 3 characters).");
                        return;
                      }
                      setPendingAdminAction({
                        kind: "enforce_action",
                        actionType: enforceActionType,
                        reason: enforceReason.trim(),
                        targetUserId: selectedThreatAccount.user_id,
                        targetLabel:
                          selectedThreatAccount.display_name ||
                          selectedThreatAccount.email ||
                          selectedThreatAccount.user_id,
                        durationMinutes: enforceActionType === "temp_account_lock" ? enforceDurationMinutes : undefined,
                      });
                    }}
                  >
                    Apply Action
                  </Button>
                </div>
              </div>
            </div>
          )}

          {isCreatingIncident && (
            <div className="w-full flex flex-col flex-1 min-h-0">
              <div className="px-5 py-3.5 border-b border-subtle flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Incident Workflow
                  </p>
                  <h2 className="text-sm font-heading font-medium text-primary truncate">
                    Create Security Incident
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeRightPanel}
                  aria-label="Close new incident panel"
                  className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newIncidentTitle.trim().length < 3) {
                    toast.error("Incident title must be at least 3 characters.");
                    return;
                  }
                  createIncidentMutation.mutate({
                    title: newIncidentTitle.trim(),
                    category: newIncidentCategory,
                    severity: newIncidentSeverity,
                    organizationId: newIncidentOrgId,
                    eventIds: newIncidentEventIds.length ? newIncidentEventIds : undefined,
                    notes: newIncidentNotes.trim() || undefined,
                  });
                }}
                className="flex-1 overflow-y-auto p-5 space-y-4 text-xs"
              >
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={200}
                    value={newIncidentTitle}
                    onChange={(e) => setNewIncidentTitle(e.target.value)}
                    placeholder="e.g. Repeated 429 rate-limit burst on /organizations"
                    className="w-full rounded-xl border border-subtle bg-surface px-3 py-2 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                      Category
                    </label>
                    <Select
                      value={newIncidentCategory}
                      onValueChange={(val) => setNewIncidentCategory(val as SecurityCategory)}
                      ariaLabel="New incident category"
                      selectSize="sm"
                      options={[
                        { value: "auth", label: "Authentication" },
                        { value: "access_control", label: "Access Control" },
                        { value: "financial", label: "Financial Integrity" },
                        { value: "api_abuse", label: "API Abuse" },
                        { value: "data_protection", label: "Data Protection" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                      Severity
                    </label>
                    <Select
                      value={newIncidentSeverity}
                      onValueChange={(val) => setNewIncidentSeverity(val as SecuritySeverity)}
                      ariaLabel="New incident severity"
                      selectSize="sm"
                      options={[
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" },
                        { value: "critical", label: "Critical" },
                      ]}
                    />
                  </div>
                </div>

                {newIncidentEventIds.length > 0 && (
                  <div className="rounded-xl border border-subtle bg-surface p-3 text-[11px] font-mono text-secondary">
                    Linked security events: {newIncidentEventIds.map((id) => `#${id}`).join(", ")}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-muted">
                    Initial Investigation Notes
                  </label>
                  <textarea
                    rows={4}
                    value={newIncidentNotes}
                    onChange={(e) => setNewIncidentNotes(e.target.value)}
                    placeholder="Context, affected endpoints, or triage notes..."
                    className="w-full rounded-xl border border-subtle bg-surface p-3 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-strong"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="secondary" size="sm" type="button" onClick={closeRightPanel}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="submit"
                    disabled={createIncidentMutation.isPending}
                  >
                    {createIncidentMutation.isPending ? "Creating..." : "Create Incident"}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </aside>
      </div>

      {/* Global Role Change Confirmation Modal */}
      <Modal
        isOpen={Boolean(pendingRoleChange)}
        onClose={() => {
          if (!roleMutation.isPending) setPendingRoleChange(null);
        }}
        maxWidth="md"
        labelledBy="confirm-role-change-title"
      >
        {pendingRoleChange && (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="space-y-1 min-w-0">
                <h2
                  id="confirm-role-change-title"
                  className="text-base font-heading font-medium text-primary"
                >
                  Confirm Global Role Change
                </h2>
                <p className="text-xs text-secondary leading-relaxed">
                  You are about to change the platform role for{" "}
                  <strong className="text-primary">
                    {pendingRoleChange.user.display_name ||
                      pendingRoleChange.user.email ||
                      pendingRoleChange.user.id}
                  </strong>
                  .
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-subtle bg-elevated/50 p-3.5 flex items-center justify-between text-xs font-mono">
              <span className="px-2 py-0.5 rounded bg-surface border border-subtle text-secondary">
                {pendingRoleChange.user.role}
              </span>
              <ArrowRight className="w-4 h-4 text-muted" />
              <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium">
                {pendingRoleChange.nextRole}
              </span>
            </div>

            {(pendingRoleChange.nextRole === "admin" ||
              pendingRoleChange.nextRole === "super_admin") && (
              <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3.5 py-2.5">
                {pendingRoleChange.nextRole === "super_admin"
                  ? "Super Admins can manage global platform roles, suspend accounts/workspaces, and view all telemetry."
                  : "Platform Admins gain access to platform telemetry, incident triage, and workspace/account oversight."}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={roleMutation.isPending}
                onClick={() => setPendingRoleChange(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                disabled={roleMutation.isPending}
                onClick={() => {
                  const target = pendingRoleChange;
                  roleMutation.mutate(
                    { userId: target.user.id, role: target.nextRole },
                    { onSettled: () => setPendingRoleChange(null) }
                  );
                }}
              >
                {roleMutation.isPending ? "Updating..." : "Confirm Role Change"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Administrative Action Confirmation Modal */}
      <Modal
        isOpen={Boolean(pendingAdminAction)}
        onClose={() => {
          if (
            !userSuspensionMutation.isPending &&
            !orgSuspensionMutation.isPending &&
            !updateIncidentMutation.isPending
          ) {
            setPendingAdminAction(null);
          }
        }}
        maxWidth="md"
        labelledBy="confirm-admin-action-title"
      >
        {pendingAdminAction && (() => {
          const isPending =
            userSuspensionMutation.isPending ||
            orgSuspensionMutation.isPending ||
            updateIncidentMutation.isPending ||
            enforceMutation.isPending;
          const isDestructive =
            (pendingAdminAction.kind === "user_suspension" && pendingAdminAction.suspended) ||
            (pendingAdminAction.kind === "org_suspension" && pendingAdminAction.suspended) ||
            (pendingAdminAction.kind === "enforce_action" &&
              (pendingAdminAction.actionType === "temp_ip_block" ||
                pendingAdminAction.actionType === "temp_account_lock" ||
                pendingAdminAction.actionType === "revoke_sessions" ||
                pendingAdminAction.actionType === "suspend_account"));

          const title =
            pendingAdminAction.kind === "user_suspension"
              ? pendingAdminAction.suspended
                ? "Confirm Account Suspension"
                : "Confirm Account Restoration"
              : pendingAdminAction.kind === "org_suspension"
                ? pendingAdminAction.suspended
                  ? "Confirm Workspace Suspension"
                  : "Confirm Workspace Restoration"
                : pendingAdminAction.kind === "enforce_action"
                  ? `Confirm ${pendingAdminAction.actionType.replace(/_/g, " ")}`
                  : "Confirm Incident Status Update";

          const confirmLabel =
            pendingAdminAction.kind === "user_suspension"
              ? pendingAdminAction.suspended
                ? "Suspend Account"
                : "Restore Account"
              : pendingAdminAction.kind === "org_suspension"
                ? pendingAdminAction.suspended
                  ? "Suspend Workspace"
                  : "Restore Workspace"
                : pendingAdminAction.kind === "enforce_action"
                  ? "Confirm Enforcement"
                  : "Update Incident";

          return (
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                    isDestructive
                      ? "bg-rose-500/15 border-rose-500/30 text-rose-400"
                      : "bg-amber-500/15 border-amber-500/30 text-amber-400"
                  }`}
                >
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="space-y-1 min-w-0">
                  <h2
                    id="confirm-admin-action-title"
                    className="text-base font-heading font-medium text-primary"
                  >
                    {title}
                  </h2>
                  {pendingAdminAction.kind === "user_suspension" && (
                    <p className="text-xs text-secondary leading-relaxed">
                      Target account:{" "}
                      <strong className="text-primary">
                        {pendingAdminAction.target.display_name ||
                          pendingAdminAction.target.email ||
                          pendingAdminAction.target.id}
                      </strong>
                    </p>
                  )}
                  {pendingAdminAction.kind === "org_suspension" && (
                    <p className="text-xs text-secondary leading-relaxed">
                      Target workspace:{" "}
                      <strong className="text-primary">{pendingAdminAction.target.name}</strong>
                    </p>
                  )}
                  {pendingAdminAction.kind === "incident_status" && (
                    <p className="text-xs text-secondary leading-relaxed">
                      Incident:{" "}
                      <strong className="text-primary">{pendingAdminAction.incident.title}</strong>
                    </p>
                  )}
                  {pendingAdminAction.kind === "enforce_action" && (
                    <p className="text-xs text-secondary leading-relaxed">
                      Target:{" "}
                      <strong className="text-primary font-mono">{pendingAdminAction.targetLabel}</strong>
                      {pendingAdminAction.durationMinutes
                        ? ` · Duration: ${pendingAdminAction.durationMinutes} min`
                        : ""}
                    </p>
                  )}
                </div>
              </div>

              {pendingAdminAction.kind === "incident_status" ? (
                <div className="rounded-xl border border-subtle bg-elevated/50 p-3.5 flex items-center justify-between text-xs font-mono">
                  <span className="px-2 py-0.5 rounded bg-surface border border-subtle text-secondary capitalize">
                    {pendingAdminAction.incident.status.replace("_", " ")}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted" />
                  <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium capitalize">
                    {pendingAdminAction.nextStatus.replace("_", " ")}
                  </span>
                </div>
              ) : (
                <div className="rounded-xl border border-subtle bg-elevated/50 p-3.5 space-y-1.5 text-xs">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Documented Reason
                  </p>
                  <p className="text-primary">{pendingAdminAction.reason}</p>
                </div>
              )}

              {isDestructive && (
                <p className="text-xs text-rose-300/90 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5">
                  {pendingAdminAction.kind === "user_suspension"
                    ? "Suspending this account immediately blocks API access and records an immutable security audit event."
                    : "Suspending this workspace immediately blocks financial and membership mutations until restored."}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={isPending}
                  onClick={() => setPendingAdminAction(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant={isDestructive ? "secondary" : "primary"}
                  size="sm"
                  type="button"
                  className={
                    isDestructive
                      ? "border-rose-500/50 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                      : undefined
                  }
                  disabled={isPending}
                  onClick={() => {
                    if (pendingAdminAction.kind === "user_suspension") {
                      userSuspensionMutation.mutate(
                        {
                          userId: pendingAdminAction.target.id,
                          suspended: pendingAdminAction.suspended,
                          reason: pendingAdminAction.reason,
                        },
                        { onSettled: () => setPendingAdminAction(null) }
                      );
                    } else if (pendingAdminAction.kind === "org_suspension") {
                      orgSuspensionMutation.mutate(
                        {
                          orgId: pendingAdminAction.target.id,
                          suspended: pendingAdminAction.suspended,
                          reason: pendingAdminAction.reason,
                        },
                        { onSettled: () => setPendingAdminAction(null) }
                      );
                    } else if (pendingAdminAction.kind === "enforce_action") {
                      enforceMutation.mutate(
                        {
                          actionType: pendingAdminAction.actionType,
                          reason: pendingAdminAction.reason,
                          targetIp: pendingAdminAction.targetIp,
                          targetUserId: pendingAdminAction.targetUserId,
                          durationMinutes: pendingAdminAction.durationMinutes,
                        },
                        { onSettled: () => setPendingAdminAction(null) }
                      );
                    } else {
                      updateIncidentMutation.mutate(
                        {
                          incidentId: pendingAdminAction.incident.id,
                          status: pendingAdminAction.nextStatus,
                          resolutionNotes: pendingAdminAction.resolutionNotes,
                        },
                        { onSettled: () => setPendingAdminAction(null) }
                      );
                    }
                  }}
                >
                  {isPending ? "Applying..." : confirmLabel}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
