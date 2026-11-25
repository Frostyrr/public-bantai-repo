import RouteErrorBoundary from "./RouteErrorBoundary";
import {
  AnimatedArchiveIcon,
  AnimatedBarChartIcon,
  AnimatedCheckSquareIcon,
  AnimatedCreditCardIcon,
  AnimatedDashboardIcon,
  AnimatedFileCheckIcon,
  AnimatedFolderKanbanIcon,
  AnimatedHandCoinsIcon,
  AnimatedHistoryIcon,
  AnimatedPieChartIcon,
  AnimatedReceiptIcon,
  AnimatedSettingsIcon,
  AnimatedShieldCheckIcon,
  AnimatedUsersIcon,
} from "../ui/SidebarAnimatedIcons";
import BaniInsights from "../dashboard/BaniInsights";
import { TourProvider } from "../onboarding/TourContext";
import WorkspaceHelpModal from "../onboarding/WorkspaceHelpModal";
import Badge from "../ui/Badge";
import FloatingMenu from "../ui/FloatingMenu";
import React, { Suspense, useState, useEffect, useRef } from "react";
import {
  Outlet,
  useParams,
  useNavigate,
  useLocation,
  useOutletContext,
  NavLink,
  Link,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Menu,
  X,
  Building2,
  Calendar,
  ShieldCheck,
  Plus,
  ArrowLeft,
  Search,
} from "lucide-react";
import SidebarTools from "./SidebarTools";
import { SidebarCollapseButton, SidebarNavigation, WorkspaceSidebar, WorkspaceSidebarDrawer } from "./WorkspaceSidebar";
import UserMenu from "../user/userMenu";
import NotificationBell from "../notifications/NotificationBell";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import DatePicker from "../ui/DatePicker";
import {
  getOrganizations,
  getReportingPeriods,
  createReportingPeriod,
  getExpenses,
  getCashAdvances,
  type Membership,
} from "../../lib/api";
import { needsExpenseReview, canReviewAdvance } from "../../utils/financialWorkflow";
import BantaiLogo from "../ui/BantaiLogo";
import { WorkspaceInspectorsContext, useWorkspaceInspectors } from "../../context/WorkspaceInspectors";
import { isFinancialScope, type FinancialScope } from "../../utils/financialCache";
import { isWorkspaceLinkClick, navigateWithTransition, useWorkspaceNavigationReady } from "../../utils/navTransition";
import { WorkspaceRouteSkeleton } from "./WorkspaceSkeletons";
import {
  WorkspaceAccessErrorCard,
  resolveWorkspaceAccessState,
} from "./WorkspaceAccessState";

const orgRouteLoaders: Record<string, () => Promise<unknown>> = {
  overview: () => import("../../pages/org/OrgOverview"),
  "my-contributions": () => import("../../pages/org/OrgMyContributions"),
  "my-profile": () => import("../../pages/org/OrgMyProfile"),
  collections: () => import("../../pages/org/OrgCollections"),
  budgets: () => import("../../pages/org/OrgBudgets"),
  expenses: () => import("../../pages/org/OrgExpenses"),
  approvals: () => import("../../pages/org/OrgApprovals"),
  liquidation: () => import("../../pages/org/OrgLiquidation"),
  reports: () => import("../../pages/org/OrgReports"),
  "audit-logs": () => import("../../pages/org/OrgAuditLogs"),
  archives: () => import("../../pages/org/OrgArchives"),
  members: () => import("../../pages/org/OrgMembers"),
  directory: () => import("../../pages/org/OrgDirectory"),
  spaces: () => import("../../pages/org/OrgSpaces"),
  settings: () => import("../../pages/org/OrgSettings"),
};

function preloadOrgRoute(to: string) {
  const segment = to.split("/").pop()?.split("?")[0];
  if (segment && orgRouteLoaders[segment]) {
    void orgRouteLoaders[segment]();
  }
}

export default function OrganizationLayout() {
  const { orgId } = useParams<{ orgId: string }>();
  return <OrganizationWorkspace key={orgId} />;
}

function OrganizationWorkspace() {
  const { orgId } = useParams<{ orgId: string }>();
  const { userId } = useOutletContext<{ userId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("bantai_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("bantai_sidebar_collapsed", String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const [drawerOpenedAtPath, setDrawerOpenedAtPath] = useState<string | null>(null);
  const isMobileDrawerOpen = drawerOpenedAtPath === location.pathname;
  const setIsMobileDrawerOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    setDrawerOpenedAtPath((prev) => {
      const open = typeof next === "function" ? next(prev === location.pathname) : next;
      return open ? location.pathname : null;
    });
  };
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0);
  const [collapsedTooltip, setCollapsedTooltip] = useState<{
    label: string;
    badgeCount?: number;
    top: number;
  } | null>(null);
  const sidebarSearchInputRef = useRef<HTMLInputElement>(null);
  const isMacPlatform =
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform || navigator.userAgent);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("all");
  const [showCreatePeriodModal, setShowCreatePeriodModal] = useState(false);
  const [showCalcRules, setShowCalcRules] = useState(false);

  const inspectors = useWorkspaceInspectors();

  // Period Modal Form State
  const [newPeriodName, setNewPeriodName] = useState("");
  const [newPeriodStart, setNewPeriodStart] = useState("");
  const [newPeriodEnd, setNewPeriodEnd] = useState("");
  const [newPeriodDefault, setNewPeriodDefault] = useState(false);
  const [periodActionError, setPeriodActionError] = useState("");
  const [isCreatingPeriod, setIsCreatingPeriod] = useState(false);

  const queryClient = useQueryClient();

  // Queries with cache-first immediate hydration
  const orgsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: getOrganizations,
    initialData: () =>
      queryClient.getQueryData<Membership[]>(["organizations"]),
  });

  const periodsQuery = useQuery({
    queryKey: ["organization-periods", orgId],
    queryFn: () => getReportingPeriods(orgId!),
    enabled: Boolean(orgId),
  });

  // Cache user's last known role and org name for instant flicker-free rendering
  const [cachedRole] = useState<string>(() => {
    return orgId ? localStorage.getItem(`bantai_role_${orgId}`) || "" : "";
  });
  const [cachedOrgName] = useState<string>(() => {
    return orgId ? localStorage.getItem(`bantai_name_${orgId}`) || "" : "";
  });

  const memberships = orgsQuery.data ?? [];
  const currentMembership = memberships.find(
    (m) => m.organization_id === orgId,
  );
  const currentOrg = currentMembership?.organizations;

  useEffect(() => {
    if (orgId && currentMembership?.role) {
      localStorage.setItem(`bantai_role_${orgId}`, currentMembership.role);
    }
    if (orgId && currentOrg?.name) {
      localStorage.setItem(`bantai_name_${orgId}`, currentOrg.name);
    }
  }, [orgId, currentMembership?.role, currentOrg?.name]);

  const memberId = currentMembership?.profile_id;
  const memberRole = currentMembership?.role;
  const membershipId = currentMembership?.id;
  const canSubmitExpenses = currentMembership?.can_submit_expenses;
  const financialScope: FinancialScope | undefined = currentOrg && memberRole && (!memberId || memberId === userId)
    ? { userId, role: memberRole, membershipId, canSubmitExpenses }
    : undefined;
  const financialRole = financialScope?.role;
  const isOfficerRole = Boolean(
    financialScope?.role && ["owner", "organization_admin", "treasurer", "auditor"].includes(financialScope.role),
  );
  const expensesBadgeQuery = useQuery({
    queryKey: ["expenses", orgId, financialScope, {}],
    queryFn: () => getExpenses(orgId!, {}, { expectedUserId: financialScope!.userId }),
    enabled: Boolean(orgId && financialScope && isOfficerRole),
    staleTime: 30_000,
  });
  const advancesBadgeQuery = useQuery({
    queryKey: ["advances", orgId, financialScope, {}],
    queryFn: () => getCashAdvances(orgId!, {}, { expectedUserId: financialScope!.userId }),
    enabled: Boolean(orgId && financialScope && isOfficerRole),
    staleTime: 30_000,
  });
  const pendingApprovalsCount =
    (expensesBadgeQuery.data?.filter((e) => needsExpenseReview(e)).length ?? 0) +
    (currentMembership
      ? (advancesBadgeQuery.data?.filter((a) =>
          canReviewAdvance(a, currentMembership.profile_id, currentMembership.role),
        ).length ?? 0)
      : 0);
  useEffect(() => {
    if (!orgsQuery.isSuccess) return;
    queryClient.removeQueries({
      predicate: ({ queryKey }) => {
        const scope = queryKey[2];
        return queryKey[1] === orgId && isFinancialScope(scope) && scope.userId === userId &&
          (scope.role !== financialRole || scope.membershipId !== membershipId || scope.canSubmitExpenses !== canSubmitExpenses);
      },
    });
  }, [canSubmitExpenses, financialRole, membershipId, orgId, orgsQuery.isSuccess, queryClient, userId]);
  const lockWorkspaceScroll = false;
  const insightsCard = orgId && memberId && memberRole && ["owner", "organization_admin", "treasurer"].includes(memberRole) ? (
    <BaniInsights
      key={orgId}
      orgId={orgId}
      currency={currentOrg?.currency}
      onAskBani={() => undefined}
    />
  ) : null;

  const activeRole = currentMembership?.role || cachedRole;
  const isOfficer =
    activeRole === "owner" ||
    activeRole === "organization_admin" ||
    activeRole === "treasurer" ||
    activeRole === "auditor";

  const [orgLogo, setOrgLogo] = useState<string>(() => {
    return (
      currentOrg?.logo_url ||
      (orgId ? localStorage.getItem(`bantai_logo_${orgId}`) || "" : "")
    );
  });

  useEffect(() => {
    const updateLogo = () => {
      if (orgId) {
        setOrgLogo(
          currentOrg?.logo_url ||
            localStorage.getItem(`bantai_logo_${orgId}`) ||
            "",
        );
      }
    };
    updateLogo();
    window.addEventListener("bantai_logo_updated", updateLogo);
    return () => window.removeEventListener("bantai_logo_updated", updateLogo);
  }, [orgId, currentOrg?.logo_url]);

  useEffect(() => {
    const handleSidebarSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSidebarCollapsed(false);
        try {
          localStorage.setItem("bantai_sidebar_collapsed", "false");
        } catch {
          // ignore storage errors
        }
        requestAnimationFrame(() => {
          sidebarSearchInputRef.current?.focus();
          sidebarSearchInputRef.current?.select();
        });
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleSidebarSearchShortcut);
    return () => window.removeEventListener("keydown", handleSidebarSearchShortcut);
  }, []);

  const handlePeriodCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !newPeriodName.trim() || !newPeriodStart || !newPeriodEnd)
      return;
    setIsCreatingPeriod(true);
    setPeriodActionError("");
    try {
      const created = await createReportingPeriod(orgId, {
        name: newPeriodName.trim(),
        startDate: newPeriodStart,
        endDate: newPeriodEnd,
        isDefault: newPeriodDefault,
      });
      await periodsQuery.refetch();
      setSelectedPeriodId(created.id);
      setShowCreatePeriodModal(false);
      setNewPeriodName("");
      setNewPeriodStart("");
      setNewPeriodEnd("");
    } catch (err: unknown) {
      setPeriodActionError(
        err instanceof Error ? err.message : "Unable to create period.",
      );
    } finally {
      setIsCreatingPeriod(false);
    }
  };

  const workspaceAccessState = resolveWorkspaceAccessState({
    isPending: orgsQuery.isPending,
    isError: orgsQuery.isError,
    isFetching: orgsQuery.isFetching,
    hasMembership: Boolean(currentMembership && currentOrg),
  });
  const isWorkspaceLoading = workspaceAccessState === "loading";
  useWorkspaceNavigationReady(!isWorkspaceLoading && Boolean(currentOrg));

  const navSections = [
    {
      title: "Workspace",
      links: [
        {
          to: `/app/org/${orgId}/overview`,
          label: "Overview",
          icon: <AnimatedDashboardIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/contributions`,
          label: "My Contributions",
          icon: <AnimatedReceiptIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/spaces`,
          label: "Projects",
          icon: <AnimatedFolderKanbanIcon className="w-[18px] h-[18px]" />,
        },
      ],
    },
    {
      title: "Finances",
      links: [
        {
          to: `/app/org/${orgId}/collections`,
          label: "Collections",
          icon: <AnimatedReceiptIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/budgets`,
          label: "Budgets",
          icon: <AnimatedPieChartIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/expenses`,
          label: "Expenses",
          icon: <AnimatedCreditCardIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/approvals`,
          label: "Approvals",
          icon: <AnimatedCheckSquareIcon className="w-[18px] h-[18px]" />,
          officerOnly: true,
          badgeCount: pendingApprovalsCount,
        },
        {
          to: `/app/org/${orgId}/reimbursements`,
          label: "Reimbursements",
          icon: <AnimatedHandCoinsIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/liquidation`,
          label: "Cash Advances",
          icon: <AnimatedFileCheckIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/reports`,
          label: "Reports",
          icon: <AnimatedBarChartIcon className="w-[18px] h-[18px]" />,
        },
      ],
    },
    {
      title: "Organization",
      links: [
        ...(activeRole &&
        ["owner", "organization_admin", "treasurer"].includes(activeRole)
          ? [
              {
                to: `/app/org/${orgId}/directory`,
                label: "Member Directory",
                icon: <AnimatedUsersIcon className="w-[18px] h-[18px]" />,
              },
            ]
          : []),
        {
          to: `/app/org/${orgId}/members`,
          label: "Workspace Access",
          icon: <AnimatedShieldCheckIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/archives`,
          label: "Archives",
          icon: <AnimatedArchiveIcon className="size-[18px]" />,
          officerOnly: true,
        },
        {
          to: `/app/org/${orgId}/audit-logs`,
          label: "Audit Logs",
          icon: <AnimatedHistoryIcon className="w-[18px] h-[18px]" />,
          officerOnly: true,
        },
        {
          to: `/app/org/${orgId}/my-profile`,
          label: "My Profile",
          icon: <AnimatedUsersIcon className="w-[18px] h-[18px]" />,
        },
        {
          to: `/app/org/${orgId}/settings`,
          label: "Settings",
          icon: <AnimatedSettingsIcon className="w-[18px] h-[18px]" />,
          officerOnly: true,
        },
      ],
    },
  ].map((section) => ({
    ...section,
    links: section.links.filter((link) => {
      // During initial loading without cached role, preserve all items rather than stripping them
      if (isWorkspaceLoading && !activeRole) return true;
      if (link.officerOnly) {
        return ["owner", "organization_admin", "treasurer", "auditor"].includes(
          activeRole || "",
        );
      }
      return true;
    }),
  }));

  const sidebarNeedle = sidebarSearch.trim().toLowerCase();
  const filteredNavSections = sidebarNeedle
    ? navSections
        .map((section) => {
          const sectionMatches = section.title.toLowerCase().includes(sidebarNeedle);
          const links = sectionMatches
            ? section.links
            : section.links.filter((link) =>
                link.label.toLowerCase().includes(sidebarNeedle),
              );
          return { ...section, links };
        })
        .filter((section) => section.links.length > 0)
    : navSections;

  const filteredNavLinks = filteredNavSections.flatMap((section) => section.links);
  const activeSearchIndex =
    filteredNavLinks.length > 0
      ? Math.min(searchSelectedIndex, filteredNavLinks.length - 1)
      : -1;
  const selectedSearchRoute =
    activeSearchIndex >= 0 ? filteredNavLinks[activeSearchIndex]?.to : undefined;
  const firstMatchedRoute = selectedSearchRoute ?? filteredNavLinks[0]?.to;

  const getRoleBadge = (role?: Membership["role"]) => {
    const effectiveRole = role || (cachedRole as Membership["role"]);
    switch (effectiveRole) {
      case "owner":
        return (
          <Badge>
            <ShieldCheck className="w-2.5 h-2.5" /> Owner
          </Badge>
        );
      case "treasurer":
        return <Badge>Treasurer</Badge>;
      case "auditor":
        return <Badge>Auditor</Badge>;
      case "organization_admin":
        return <Badge>Admin</Badge>;
      default:
        if (isWorkspaceLoading && !effectiveRole) {
          return (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted bg-secondary-surface border border-subtle px-2 py-0.5 rounded-full animate-pulse">
              ...
            </span>
          );
        }
        return <Badge>Member</Badge>;
    }
  };

  const activePeriod = periodsQuery.data?.find(
    (p) => p.id === selectedPeriodId,
  );
  const isDataFetching = orgsQuery.isFetching || periodsQuery.isFetching;

  if (workspaceAccessState === "error") {
    return (
      <WorkspaceAccessErrorCard
        mode="error"
        error={orgsQuery.error}
        onRetry={() => void orgsQuery.refetch()}
      />
    );
  }

  if (workspaceAccessState === "inaccessible") {
    return <WorkspaceAccessErrorCard mode="inaccessible" />;
  }

  return (
    <TourProvider
      key={`${orgId ?? "none"}:${userId ?? "anon"}`}
      orgId={orgId}
      role={activeRole}
      workspaceReady={!isWorkspaceLoading && Boolean(currentOrg)}
    >
    <div className="workspace-layout [--workspace-navbar-height:3.5rem] h-dvh max-h-dvh bg-canvas text-primary flex flex-col font-body font-normal relative overflow-hidden">
      {/* Top Organization Navigation Bar */}
      <header className="app-navbar-surface h-(--workspace-navbar-height) shrink-0 border-b border-subtle bg-surface sticky top-0 z-50 md:z-40 md:bg-surface/95 px-4 sm:px-6 flex items-center justify-between hardware-sharp relative backdrop-blur-md max-md:gap-2 max-md:px-3">
        {/* Sleek Horizontal Indeterminate Loading Bar Under Navbar */}
        {(isWorkspaceLoading || isDataFetching) && (
          <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-subtle overflow-hidden z-50">
            <div className="animate-loading-bar bg-action" />
          </div>
        )}
        <div className="flex items-center gap-2.5 sm:gap-3 max-md:min-w-0 max-md:flex-1 max-md:gap-2">
          {/* Logo & Workspace Brand (Desktop/Tablet) */}
          <Link
            to="/dashboard"
            onClick={(e) => {
              if (!isWorkspaceLinkClick(e)) return;
              e.preventDefault();
              navigateWithTransition(() => navigate("/dashboard"), "/dashboard");
            }}
            className="app-brand-mark hidden items-center gap-2.5 shrink-0 md:flex"
          >
            <BantaiLogo
              alt="Bantai"
              className="w-7 h-7 object-contain dark:drop-shadow-[0_0_12px_rgba(255,255,255,0.2)]"
            />
            <span className="font-heading font-medium text-lg tracking-tight text-primary">
              Bantai
            </span>
          </Link>

          <span className="text-muted hidden md:inline">/</span>

          <Link
            to="/app"
            onClick={(e) => {
              if (!isWorkspaceLinkClick(e)) return;
              e.preventDefault();
              navigateWithTransition(() => navigate("/app"), "/app");
            }}
            className="hidden shrink-0 text-sm text-secondary hover:text-primary md:inline"
          >
            My Organizations
          </Link>
          <span className="hidden text-muted md:inline">/</span>
          {/* Mobile Drawer Toggle */}
          <button
            type="button"
            data-tour="mobile-nav-trigger"
            onClick={() => setIsMobileDrawerOpen(true)}
            aria-label="Open workspace navigation"
            aria-haspopup="dialog"
            aria-controls="organization-navigation-drawer"
            className="flex size-11 shrink-0 items-center justify-center md:hidden rounded-lg bg-elevated border border-subtle text-secondary hover:text-primary cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Organization Switcher Dropdown */}
          <div className={`relative max-md:flex-1 max-md:min-w-0 ${showOrgDropdown ? "z-[99999]" : ""}`}>
            <button
              type="button"
              onClick={() => {
                setShowOrgDropdown((prev) => !prev);
                setShowPeriodDropdown(false);
              }}
              className="flex items-center gap-2 h-9 px-3.5 rounded-full bg-elevated border border-subtle hover:border-strong text-sm font-medium text-primary transition-all cursor-pointer max-md:mx-auto max-md:w-full max-md:max-w-[260px] max-md:justify-between max-md:gap-1.5 max-md:px-2.5 max-md:text-xs"
            >
              <div className="w-6 h-6 max-md:size-5 rounded-md overflow-hidden bg-canvas flex items-center justify-center shrink-0 border border-subtle shadow-xs">
                {orgLogo ? (
                  <img
                    src={orgLogo}
                    alt={currentOrg?.name ?? "Org"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-secondary" />
                )}
              </div>
              <span className="truncate max-md:flex-1 max-md:text-left sm:max-w-[220px] max-md:min-w-0">
                {currentOrg?.name ||
                  cachedOrgName ||
                  (isWorkspaceLoading ? "Loading..." : "Select Org")}
              </span>
              <span className="shrink-0 flex items-center max-md:[&_svg]:hidden max-md:[&>span]:px-1 max-md:[&>span]:text-[10px]">
                {getRoleBadge(currentMembership?.role)}
              </span>
              <ChevronDown className={`w-3 h-3 text-secondary shrink-0 transition-transform duration-200 ${showOrgDropdown ? "rotate-180 text-primary" : ""}`} />
            </button>

            <FloatingMenu
              open={showOrgDropdown}
              onClose={() => setShowOrgDropdown(false)}
              className="absolute left-0 mt-2 w-64 rounded-2xl bg-surface border border-subtle shadow-2xl p-2 z-[99999] hardware-sharp"
            >
                <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted border-b border-subtle">
                  Switch Organization
                </div>
                <div className="py-1 max-h-56 overflow-y-auto space-y-0.5">
                  {memberships.map((m) => (
                    <button
                      key={m.organization_id}
                      type="button"
                      onClick={() => {
                        setShowOrgDropdown(false);
                        const destination = `/app/org/${m.organization_id}/overview`;
                        navigateWithTransition(() => navigate(destination), destination);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors text-left cursor-pointer ${
                        m.organization_id === orgId
                          ? "bg-elevated text-primary font-medium"
                          : "text-secondary hover:text-primary hover:bg-elevated"
                      }`}
                    >
                      <span className="truncate">{m.organizations?.name}</span>
                      {getRoleBadge(m.role)}
                    </button>
                  ))}
                </div>
                <div className="pt-2 border-t border-subtle">
                  <Link
                    to="/app"
                    onClick={(e) => {
                      if (!isWorkspaceLinkClick(e)) return;
                      e.preventDefault();
                      setShowOrgDropdown(false);
                      navigateWithTransition(() => navigate("/app"), "/app");
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-secondary hover:text-primary hover:bg-elevated transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Organizations
                  </Link>
                </div>
            </FloatingMenu>
          </div>
        </div>

        {/* Right Header: Calculation Rules, Period Selector, Role Badge & UserMenu */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 sm:gap-3 md:flex">
            {/* Reporting Period Selector Dropdown (Desktop/Tablet) */}
            <div
              className={`relative ${showPeriodDropdown ? "z-[99999]" : ""} hidden md:block`}
            >
              <button
                type="button"
                onClick={() => {
                  setShowPeriodDropdown((prev) => !prev);
                  setShowOrgDropdown(false);
                }}
                className="flex items-center gap-2 h-9 px-3.5 rounded-full bg-elevated border border-subtle hover:border-strong text-sm font-medium text-primary transition-all cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5 text-secondary shrink-0" />
                <span className="hidden sm:inline max-w-[110px] sm:max-w-[150px] truncate">
                  {selectedPeriodId === "all"
                    ? "All Periods"
                    : (activePeriod?.name ?? "Active Period")}
                </span>
                <ChevronDown className={`w-3 h-3 text-secondary shrink-0 transition-transform duration-200 ${showPeriodDropdown ? "rotate-180 text-primary" : ""}`} />
              </button>

              <FloatingMenu
                open={showPeriodDropdown}
                onClose={() => setShowPeriodDropdown(false)}
                align="right"
                className="absolute right-0 mt-2 w-64 rounded-2xl bg-surface border border-subtle shadow-2xl p-2 z-[99999] hardware-sharp"
              >
                  <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted border-b border-subtle flex items-center justify-between">
                    <span>Reporting Period</span>
                    {isOfficer && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowPeriodDropdown(false);
                          setShowCreatePeriodModal(true);
                        }}
                        className="text-emerald-500 hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" /> New
                      </button>
                    )}
                  </div>

                  <div className="py-1 max-h-56 overflow-y-auto space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPeriodId("all");
                        setShowPeriodDropdown(false);
                      }}
                      className={`w-full px-3 py-2 rounded-xl text-xs text-left cursor-pointer transition-colors ${
                        selectedPeriodId === "all"
                          ? "bg-elevated text-primary font-medium"
                          : "text-secondary hover:text-primary hover:bg-elevated"
                      }`}
                    >
                      All Historical Records
                    </button>

                    {periodsQuery.data?.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPeriodId(p.id);
                          setShowPeriodDropdown(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-left cursor-pointer transition-colors ${
                          selectedPeriodId === p.id
                            ? "bg-elevated text-primary font-medium"
                            : "text-secondary hover:text-primary hover:bg-elevated"
                        }`}
                      >
                        <span className="truncate">{p.name}</span>
                        {p.is_default && (
                          <span className="text-[9px] font-mono text-emerald-500 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                            Current
                          </span>
                        )}
                      </button>
                    ))}

                    {periodsQuery.data?.length === 0 && (
                      <div className="p-3 text-center text-xs text-muted">
                        No custom periods set. Operating in continuous cycle.
                      </div>
                    )}
                  </div>
              </FloatingMenu>
            </div>

          </div>
          <NotificationBell organizationId={orgId} />

          <UserMenu compactOnMobile organizationDisplayName={currentMembership?.display_name}/>
        </div>
      </header>

      {/* Main Container: Sidebar + Content */}
      <div className="workspace-body flex-1 flex overflow-hidden min-h-0">
        {/* Desktop Collapsible Sidebar */}
        <WorkspaceSidebar className={`workspace-transition-sidebar relative z-20 select-none workspace-sidebar-surface ${isSidebarCollapsed ? "w-[72px]" : "w-60"}`}>
          {!isSidebarCollapsed ? (
            <div className="px-2.5 pt-3 pb-1 flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={sidebarSearchInputRef}
                  type="text"
                  value={sidebarSearch}
                  onChange={(e) => {
                    setSidebarSearch(e.target.value);
                    setSearchSelectedIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      if (sidebarSearch) {
                        setSidebarSearch("");
                        setSearchSelectedIndex(0);
                      } else {
                        e.currentTarget.blur();
                      }
                    } else if (e.key === "ArrowDown" && filteredNavLinks.length > 0) {
                      e.preventDefault();
                      setSearchSelectedIndex((prev) => (prev + 1) % filteredNavLinks.length);
                    } else if (e.key === "ArrowUp" && filteredNavLinks.length > 0) {
                      e.preventDefault();
                      setSearchSelectedIndex((prev) => (prev - 1 + filteredNavLinks.length) % filteredNavLinks.length);
                    } else if (e.key === "Enter" && firstMatchedRoute) {
                      navigate(firstMatchedRoute);
                      setSidebarSearch("");
                      setSearchSelectedIndex(0);
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Search..."
                  aria-label="Search workspace modules"
                  aria-keyshortcuts={isMacPlatform ? "Meta+K" : "Control+K"}
                  className={`w-full h-8 pl-8 rounded-lg bg-canvas border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors ${
                    sidebarSearch ? "pr-6" : isMacPlatform ? "pr-11" : "pr-13"
                  }`}
                />
                {sidebarSearch ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSidebarSearch("");
                      setSearchSelectedIndex(0);
                      sidebarSearchInputRef.current?.focus();
                    }}
                    aria-label="Clear module search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center rounded border border-subtle bg-surface px-1.5 py-0.5 text-[10px] font-mono text-muted">
                    {isMacPlatform ? "⌘K" : "Ctrl K"}
                  </kbd>
                )}
              </div>
              <SidebarCollapseButton collapsed={false} onToggle={toggleSidebar} />
            </div>
          ) : (
            <div className="px-2.5 pt-3 pb-1 flex flex-col items-center gap-1.5">
              <SidebarCollapseButton collapsed onToggle={toggleSidebar} />
              <button
                type="button"
                onClick={() => {
                  setIsSidebarCollapsed(false);
                  try {
                    localStorage.setItem("bantai_sidebar_collapsed", "false");
                  } catch {
                    // ignore storage errors
                  }
                  requestAnimationFrame(() => {
                    sidebarSearchInputRef.current?.focus();
                  });
                }}
                aria-label={`Search workspace modules (${isMacPlatform ? "⌘K" : "Ctrl+K"})`}
                title={`Search modules (${isMacPlatform ? "⌘K" : "Ctrl+K"})`}
                className="group grid size-9 cursor-pointer place-items-center rounded-lg text-secondary hover:bg-hover-surface hover:text-primary"
              >
                <Search size={15} className="sidebar-nav-icon transition-transform duration-200 ease-out group-hover:scale-110" />
              </button>
            </div>
          )}

          {/* Navigation Sections */}
          <SidebarNavigation data-tour="nav-sidebar" aria-label="Workspace navigation" className="scrollbar-none flex flex-col gap-1.5 px-2.5 py-2.5">
            {filteredNavSections.length === 0 ? (
              !isSidebarCollapsed && (
                <p className="px-2.5 py-4 text-xs text-muted text-center">
                  No modules match "{sidebarSearch}".
                </p>
              )
            ) : (
              filteredNavSections.map((section, sIdx) => (
              <div key={section.title} className={`space-y-0.5 ${sIdx > 0 ? "mt-1.5 pt-2.5 border-t border-subtle" : ""}`}>
                {!isSidebarCollapsed && (
                  <div className="px-2.5 pb-1">
                    <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted">
                      {section.title}
                    </span>
                  </div>
                )}
                {section.links.map((link) => {
                  const badgeCount =
                    "badgeCount" in link && typeof link.badgeCount === "number"
                      ? link.badgeCount
                      : 0;
                  const isSearchFocused =
                    Boolean(sidebarNeedle) && selectedSearchRoute === link.to;
                  return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    title={isSidebarCollapsed ? undefined : link.label}
                    onMouseEnter={(e) => {
                      preloadOrgRoute(link.to);
                      if (isSidebarCollapsed) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setCollapsedTooltip({
                          label: link.label,
                          badgeCount,
                          top: rect.top + rect.height / 2,
                        });
                      }
                    }}
                    onMouseLeave={() => {
                      if (isSidebarCollapsed) setCollapsedTooltip(null);
                    }}
                    onFocus={(e) => {
                      preloadOrgRoute(link.to);
                      if (isSidebarCollapsed) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setCollapsedTooltip({
                          label: link.label,
                          badgeCount,
                          top: rect.top + rect.height / 2,
                        });
                      }
                    }}
                    onBlur={() => {
                      if (isSidebarCollapsed) setCollapsedTooltip(null);
                    }}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-3 rounded-lg text-[13px] border outline-none select-none transition-colors duration-150 ${
                        isActive
                          ? "bg-selected-surface text-primary font-medium border-subtle dark:border-transparent shadow-xs dark:shadow-none"
                          : isSearchFocused
                          ? "bg-hover-surface text-primary border-strong font-medium"
                          : "border-transparent text-primary/80 dark:text-secondary hover:text-primary hover:bg-hover-surface font-medium dark:font-normal"
                      } ${
                        isSidebarCollapsed
                          ? "w-10 h-10 mx-auto justify-center p-0"
                          : "px-2.5 py-1.5"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className={`absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary ${
                              isSidebarCollapsed ? "h-5" : "h-4"
                            }`}
                          />
                        )}
                        <span className="shrink-0 flex items-center justify-center">
                          {link.icon}
                        </span>
                        {!isSidebarCollapsed && (
                          <span className="truncate flex-1">{link.label}</span>
                        )}
                        {!isSidebarCollapsed && badgeCount > 0 && (
                          <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full border border-subtle bg-elevated px-1.5 py-0.5 text-[10px] font-mono font-medium tabular-nums text-primary">
                            {badgeCount > 99 ? "99+" : badgeCount}
                          </span>
                        )}
                        {isSidebarCollapsed && badgeCount > 0 && (
                          <span
                            aria-hidden="true"
                            className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500 ring-2 ring-surface"
                          />
                        )}
                      </>
                    )}
                  </NavLink>
                  );
                })}
              </div>
              ))
            )}
          </SidebarNavigation>
          {isSidebarCollapsed && collapsedTooltip && (
            <div
              role="tooltip"
              style={{ top: `${collapsedTooltip.top}px` }}
              className="pointer-events-none fixed left-[78px] z-50 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs font-medium text-primary shadow-lg"
            >
              <span>{collapsedTooltip.label}</span>
              {Boolean(collapsedTooltip.badgeCount) && collapsedTooltip.badgeCount! > 0 && (
                <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-secondary">
                  {collapsedTooltip.badgeCount}
                </span>
              )}
            </div>
          )}
          <SidebarTools collapsed={isSidebarCollapsed} onHelp={() => setShowCalcRules(true)} />
        </WorkspaceSidebar>

        <WorkspaceSidebarDrawer id="organization-navigation-drawer" label="Workspace navigation"
          open={isMobileDrawerOpen} onOpenChange={setIsMobileDrawerOpen}
          className="w-80 workspace-sidebar-surface p-5"
          heading={
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg overflow-hidden bg-surface border border-subtle flex items-center justify-center shrink-0">
                {orgLogo ? (
                  <img
                    src={orgLogo}
                    alt={currentOrg?.name ?? "Bantai"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <BantaiLogo
                    alt="Bantai"
                    className="w-6 h-6 object-contain"
                  />
                )}
              </div>
              <span className="font-heading font-medium text-primary text-base truncate">
                {currentOrg?.name || cachedOrgName || "Bantai"}
              </span>
            </div>
          }>
            {/* Mobile Quick Link: Organizations */}
            <Link
              to="/app"
              onClick={event => {
                if (!isWorkspaceLinkClick(event)) return;
                event.preventDefault();
                setIsMobileDrawerOpen(false);
                navigateWithTransition(() => navigate("/app"), "/app");
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-secondary hover:text-primary bg-elevated border border-subtle mb-3"
            >
              <Building2 className="w-4 h-4 text-muted" />
              <span className="font-medium">Organizations</span>
            </Link>

            <div className="mb-4 px-1">
              {getRoleBadge(currentMembership?.role)}
            </div>

            {/* Mobile Reporting Period Selector */}
            {periodsQuery.data && periodsQuery.data.length > 0 && (
              <div className="mb-4 px-1">
                <label
                  htmlFor="mobile-reporting-period"
                  className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5"
                >
                  Reporting Period
                </label>
                <select
                  id="mobile-reporting-period"
                  value={selectedPeriodId ?? ""}
                  onChange={(e) => setSelectedPeriodId(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium text-primary bg-elevated border border-subtle focus:outline-none focus:border-emerald-500/50 transition-colors cursor-pointer"
                >
                  {periodsQuery.data.map((period) => (
                    <option
                      key={period.id}
                      value={period.id}
                      className="bg-surface text-primary"
                    >
                      {period.name}
                      {period.is_default ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && firstMatchedRoute) {
                    navigate(firstMatchedRoute);
                    setSidebarSearch("");
                    setIsMobileDrawerOpen(false);
                  }
                }}
                placeholder="Search modules..."
                aria-label="Search workspace modules"
                className="w-full h-9 pl-8 pr-7 rounded-lg bg-canvas border border-subtle text-xs text-primary placeholder:text-muted focus:outline-none focus:border-strong transition-colors"
              />
              {sidebarSearch && (
                <button
                  type="button"
                  onClick={() => setSidebarSearch("")}
                  aria-label="Clear module search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <SidebarNavigation aria-label="Workspace navigation" className="flex flex-col gap-1.5">
              {filteredNavSections.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted text-center">
                  No modules match "{sidebarSearch}".
                </p>
              ) : (
                filteredNavSections.map((section, sIdx) => (
                <div key={section.title} className={`space-y-0.5 ${sIdx > 0 ? "mt-1.5 pt-2.5 border-t border-subtle" : ""}`}>
                  <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-[0.14em] text-muted">
                    {section.title}
                  </div>
                  {section.links.map((link) => {
                    const badgeCount =
                      "badgeCount" in link && typeof link.badgeCount === "number"
                        ? link.badgeCount
                        : 0;
                    return (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      onClick={() => setIsMobileDrawerOpen(false)}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium border outline-none select-none transition-colors duration-150 ${
                          isActive
                            ? "bg-selected-surface text-primary font-medium border-subtle dark:border-transparent shadow-xs dark:shadow-none"
                            : "border-transparent text-primary/80 dark:text-secondary hover:text-primary hover:bg-hover-surface font-medium dark:font-normal"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
                            />
                          )}
                          {link.icon}
                          <span className="flex-1 truncate">{link.label}</span>
                          {badgeCount > 0 && (
                            <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full border border-subtle bg-elevated px-1.5 py-0.5 text-[10px] font-mono font-medium tabular-nums text-primary">
                              {badgeCount > 99 ? "99+" : badgeCount}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                    );
                  })}
                </div>
                ))
              )}
            </SidebarNavigation>

            <SidebarTools key={String(isMobileDrawerOpen)} onFeedback={() => setIsMobileDrawerOpen(false)}
              onHelp={() => { setIsMobileDrawerOpen(false); setShowCalcRules(true); }} />
        </WorkspaceSidebarDrawer>
        {/* Main Content Workspace Outlet */}
        <main inert={lockWorkspaceScroll} className={`workspace-canvas workspace-gutters max-md:pb-24 flex-1 min-w-0 ${lockWorkspaceScroll ? "overflow-hidden" : "overflow-y-auto"}`}>
          {isWorkspaceLoading ? (
            <WorkspaceRouteSkeleton pathname={location.pathname} />
          ) : (
            <WorkspaceInspectorsContext.Provider value={inspectors}>
              <RouteErrorBoundary resetKey={location.pathname} embedded>
                <Suspense fallback={<WorkspaceRouteSkeleton pathname={location.pathname} />}>
                  <Outlet
                    key={orgId}
                    context={{
                      organization: currentOrg,
                      membership: currentMembership,
                      financialScope,
                      activePeriodId: activePeriod ? selectedPeriodId : "all",
                      setSelectedPeriodId,
                      insightsStrip: insightsCard,
                      reportingPeriods: periodsQuery.data ?? [],
                    }}
                  />
                </Suspense>
              </RouteErrorBoundary>
            </WorkspaceInspectorsContext.Provider>
          )}
        </main>
      </div>

      <WorkspaceHelpModal
        isOpen={showCalcRules}
        onClose={() => setShowCalcRules(false)}
        orgId={orgId}
        role={activeRole}
      />

      {/* Modal: Create Reporting Period */}
      <Modal
        isOpen={showCreatePeriodModal}
        onClose={() => setShowCreatePeriodModal(false)}
        maxWidth="md"
      >
        <button
          type="button"
          onClick={() => setShowCreatePeriodModal(false)}
          className="absolute top-5 right-5 text-secondary hover:text-primary p-1 rounded-full cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-primary">
            <Calendar className="w-5 h-5" />
          </div>
          <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
            Create Reporting Period
          </h3>
        </div>

        <p className="text-xs text-secondary font-body mb-6 leading-relaxed">
          Define a custom time interval (academic semester, fiscal quarter, or
          annual cycle) for reporting and financial filtering.
        </p>

        {periodActionError && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs">
            {periodActionError}
          </div>
        )}

        <form onSubmit={handlePeriodCreate} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-body font-normal text-secondary">
              Period Name
            </label>
            <input
              type="text"
              placeholder="e.g. AY 2026-2027 Semester 1"
              value={newPeriodName}
              onChange={(e) => setNewPeriodName(e.target.value)}
              required
              disabled={isCreatingPeriod}
              className="bg-elevated border border-subtle text-primary rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-strong"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DatePicker
              label="Start Date"
              value={newPeriodStart}
              onChange={setNewPeriodStart}
              required
              disabled={isCreatingPeriod}
              size="sm"
            />
            <DatePicker
              label="End Date"
              value={newPeriodEnd}
              onChange={setNewPeriodEnd}
              required
              disabled={isCreatingPeriod}
              size="sm"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-xs text-secondary pt-1">
            <input
              type="checkbox"
              checked={newPeriodDefault}
              onChange={(e) => setNewPeriodDefault(e.target.checked)}
              className="w-4 h-4 rounded border-strong bg-elevated text-primary accent-primary"
            />
            <span>Set as default active period for this organization</span>
          </label>

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={isCreatingPeriod}
              disabled={
                !newPeriodName.trim() || !newPeriodStart || !newPeriodEnd
              }
            >
              Create Reporting Period
            </Button>
          </div>
        </form>
      </Modal>
    </div>
    </TourProvider>
  );
}
