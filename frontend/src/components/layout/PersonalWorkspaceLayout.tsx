import { useCallback, useState, Suspense, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Outlet, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Building2, CreditCard, Menu, Search, Settings, X } from "lucide-react";
import { getOrganizations, type Membership } from "../../lib/api";
import SidebarTools from "./SidebarTools";
import { PersonalWorkspaceRouteSkeleton } from "./WorkspaceSkeletons";
import { SidebarCollapseButton, SidebarNavigation, WorkspaceSidebar, WorkspaceSidebarDrawer } from "./WorkspaceSidebar";
import Modal from "../ui/Modal";
import BantaiLogo from "../ui/BantaiLogo";
import NotificationBell from "../notifications/NotificationBell";
import UserMenu from "../user/userMenu";
import { isWorkspaceLinkClick, navigateWithTransition, useWorkspaceNavigationReady } from "../../utils/navTransition";

export interface PersonalWorkspaceContext {
  userId: string;
  headerActions: HTMLDivElement | null;
  organizationsQuery: UseQueryResult<Membership[]>;
}

export function PersonalHeaderActions({ loading, children }: { loading?: boolean; children?: ReactNode }) {
  const { headerActions } = useOutletContext<PersonalWorkspaceContext>();
  if (!headerActions) return null;
  return createPortal(
    <>
      {loading && (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-subtle">
          <div className="animate-loading-bar bg-action" />
        </div>
      )}
      {children}
    </>,
    headerActions,
  );
}

function PersonalNavigationTrigger({ openNavigation }: { openNavigation: () => void }) {
  return (
    <button type="button" aria-label="Open personal navigation" aria-haspopup="dialog"
      aria-controls="personal-navigation-drawer" onClick={openNavigation}
      className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary hover:bg-elevated focus-visible:outline-2 md:hidden">
      <Menu size={20} aria-hidden="true" />
    </button>
  );
}

const links = [
  { label: "My Organizations", to: "/app/organizations", paths: ["/dashboard", "/app", "/app/organizations"], Icon: Building2 },
  { label: "Personal Payments", to: "/app/payments", paths: ["/app/payments"], Icon: CreditCard },
  { label: "Account Settings", to: "/app/settings", paths: ["/app/settings"], Icon: Settings },
];

export default function PersonalWorkspaceLayout() {
  const { userId } = useOutletContext<{ userId: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useWorkspaceNavigationReady();
  const [showHelp, setShowHelp] = useState(false);
  const [drawerOpenedAtPath, setDrawerOpenedAtPath] = useState<string | null>(null);
  const drawerOpen = drawerOpenedAtPath === pathname;
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(null);
  const organizationsQuery = useQuery({ queryKey: ["organizations"], queryFn: getOrganizations });
  const memberships = organizationsQuery.data ?? [];
  const openNavigation = useCallback(() => setDrawerOpenedAtPath(pathname), [pathname]);
  const closeNavigation = useCallback(() => setDrawerOpenedAtPath(null), []);
  const setDrawerOpen = useCallback(
    (open: boolean) => setDrawerOpenedAtPath(open ? pathname : null),
    [pathname]
  );
  const openHelp = () => {
    closeNavigation();
    setShowHelp(true);
  };

  const currentPage = links.find(link => link.paths.includes(pathname.replace(/\/$/, ""))) ?? links[0];
  const isOrganizations = currentPage === links[0];
  const query = search.trim().toLowerCase();
  const visibleLinks = links.filter(link => link.label.toLowerCase().includes(query));
  const visibleMemberships = memberships.filter(item => item.organizations?.name.toLowerCase().includes(query));

  function renderBrand() {
    return (
      <Link to="/app/organizations" aria-label="Bantai, My Organizations" onClick={closeNavigation}
        className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2">
        <BantaiLogo alt="" className="size-7 shrink-0 object-contain" />
        <span className="font-heading text-lg font-medium tracking-tight text-primary">Bantai</span>
      </Link>
    );
  }

  function renderSidebar(compact: boolean, mobile = false) {
    const itemClass = "flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-sm text-secondary hover:bg-hover-surface hover:text-primary focus-visible:outline-2";
    return (
      <>
        <div className={`flex shrink-0 items-center gap-1.5 px-2.5 pt-3 pb-1 ${compact ? "justify-center" : ""}`}>
          {!compact && (
            <div className="relative min-w-0 flex-1">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input type="text" value={search} onChange={event => setSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Escape" && search) {
                    event.preventDefault();
                    setSearch("");
                  }
                }}
                placeholder="Search..." aria-label="Search personal navigation"
                className="h-8 w-full rounded-lg border border-subtle bg-canvas pl-8 pr-8 text-xs text-primary placeholder:text-muted focus:border-strong focus:outline-none" />
              {search && (
                <button type="button" aria-label="Clear sidebar search" onClick={() => setSearch("")}
                  className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded text-muted hover:text-primary focus-visible:outline-2">
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {!mobile && (
            <SidebarCollapseButton collapsed={compact} onToggle={() => {
              if (!compact) setSearch("");
              setCollapsed(!compact);
            }} />
          )}
        </div>
        <SidebarNavigation aria-label="Personal workspace" className="space-y-1 p-2">
          {visibleLinks.map(({ label, to, paths, Icon }) => {
            const active = paths.includes(pathname.replace(/\/$/, ""));
            return (
              <Link key={to} to={to} title={compact ? label : undefined} aria-label={label}
                aria-current={active ? "page" : undefined} onClick={closeNavigation}
                className={`${itemClass} ${compact ? "justify-center" : ""} ${active ? "bg-selected-surface font-medium text-primary!" : ""}`}>
                <Icon size={17} className="shrink-0" aria-hidden="true" />
                {!compact && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
          {visibleMemberships.length > 0 && (
            <div aria-label="Organization shortcuts" role="group" className="mt-3 space-y-1 border-t border-subtle pt-2">
              {!compact && <p className="px-2.5 py-1 text-xs font-medium text-muted">Organizations</p>}
              {visibleMemberships.map(({ organization_id, organizations: organization }) => organization && (
                <Link key={organization_id} to={`/app/org/${organization_id}/overview`}
                  title={organization.name} aria-label={organization.name} onClick={event => {
                    if (!isWorkspaceLinkClick(event)) return;
                    event.preventDefault();
                    closeNavigation();
                    const destination = `/app/org/${organization_id}/overview`;
                    navigateWithTransition(() => navigate(destination), destination);
                  }}
                  className={`${itemClass} ${compact ? "justify-center" : ""}`}>
                  <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-md border border-subtle bg-canvas text-xs font-semibold" aria-hidden="true">
                    {organization.logo_url
                      ? <img src={organization.logo_url} alt="" className="size-full object-cover" loading="lazy" />
                      : organization.name.trim().slice(0, 2).toUpperCase()}
                  </span>
                  {!compact && <span className="truncate">{organization.name}</span>}
                </Link>
              ))}
            </div>
          )}
          {query && visibleLinks.length === 0 && visibleMemberships.length === 0 && (
            <p role="status" className="px-2.5 py-2 text-xs text-muted">No matching links or organizations.</p>
          )}
        </SidebarNavigation>
      </>
    );
  }

  return (
    <div className="min-h-dvh workspace-canvas [--workspace-navbar-height:3.5rem]">
      <header className="app-navbar-surface sticky top-0 z-40 flex h-(--workspace-navbar-height) items-center justify-between gap-2 border-b border-subtle bg-surface px-3 backdrop-blur-md md:gap-3 md:bg-surface/95 md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <PersonalNavigationTrigger openNavigation={openNavigation} />
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-2.5 text-sm md:gap-3">
              <li className="shrink-0">
                <Link to="/app/organizations" aria-label="Bantai home"
                  className="app-brand-mark flex items-center gap-2.5 rounded-sm font-heading text-lg font-medium tracking-tight text-primary focus-visible:outline-2">
                  <BantaiLogo alt="" className="size-7 object-contain" />
                  <span className="max-sm:sr-only">Bantai</span>
                </Link>
              </li>
              {!isOrganizations && (
                <li className="hidden shrink-0 items-center gap-3 md:flex">
                  <span aria-hidden="true" className="w-1.5 shrink-0 text-center text-muted">/</span>
                  <Link to="/app/organizations" className="rounded-sm text-secondary transition-colors hover:text-primary focus-visible:outline-2">
                    My Organizations
                  </Link>
                </li>
              )}
              <li aria-current="page" className="flex min-w-0 items-center gap-2.5 font-medium text-primary md:gap-3">
                <span aria-hidden="true" className="w-1.5 shrink-0 text-center text-muted">/</span>
                <span className="truncate">{currentPage.label}</span>
              </li>
            </ol>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div ref={setHeaderActions} className="flex items-center gap-2 empty:hidden max-md:contents" />
          <NotificationBell />
          <UserMenu compactOnMobile />
        </div>
      </header>
      <div className="flex min-h-[calc(100dvh-var(--workspace-navbar-height))] items-start">
        <WorkspaceSidebar className={`workspace-transition-sidebar sticky top-(--workspace-navbar-height) h-[calc(100dvh-var(--workspace-navbar-height))] workspace-sidebar-surface ${collapsed ? "w-[72px]" : "w-60"}`}>
          {renderSidebar(collapsed)}
          <SidebarTools collapsed={collapsed} onHelp={openHelp} />
        </WorkspaceSidebar>
        <div className="min-w-0 flex-1">
          <Suspense fallback={<PersonalWorkspaceRouteSkeleton pathname={pathname} />}>
            <Outlet context={{ userId, headerActions, organizationsQuery } satisfies PersonalWorkspaceContext} />
          </Suspense>
        </div>
      </div>
      <WorkspaceSidebarDrawer id="personal-navigation-drawer" label="Personal navigation"
        open={drawerOpen} onOpenChange={setDrawerOpen} className="w-80 workspace-sidebar-surface p-5"
        heading={renderBrand()}>
        {renderSidebar(false, true)}
        {drawerOpen && <SidebarTools onFeedback={closeNavigation} onHelp={openHelp} />}
      </WorkspaceSidebarDrawer>
      <Modal isOpen={showHelp} onClose={() => setShowHelp(false)} maxWidth="sm" labelledBy="personal-workspace-help">
        <h2 id="personal-workspace-help" className="modal-title mb-3">Personal workspace help</h2>
        <div className="space-y-2 text-sm text-secondary">
          <p><strong className="text-primary">My Organizations</strong> lets you open, join, or create a workspace.</p>
          <p><strong className="text-primary">Personal Payments</strong> shows your contributions and outstanding payments.</p>
          <p><strong className="text-primary">Account Settings</strong> lets you manage your profile and preferences.</p>
        </div>
        <button type="button" onClick={() => setShowHelp(false)}
          className="mt-4 min-h-11 cursor-pointer rounded-full bg-action px-4 text-sm text-action-fg focus-visible:ring-2 focus-visible:ring-strong">
          Done
        </button>
      </Modal>
    </div>
  );
}
