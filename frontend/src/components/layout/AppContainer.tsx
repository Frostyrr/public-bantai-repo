import RouteErrorBoundary from "./RouteErrorBoundary";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notifySettingsRouteCommit } from "../../utils/settingsTransition";
import useAuth, { AUTH, type UserProfile } from "../../hooks/useAuth";
import { formatErrorMessage } from "../../utils/formatError";
import { getUserPreferences, logout } from "../../lib/api";
import AccountOnboarding from "../user/AccountOnboarding";
import ProfileCompletionNotice from "../user/ProfileCompletionNotice";
import { useTheme } from "../../context/ThemeContext";
import { isFinancialScope } from "../../utils/financialCache";
import { createFormDraftStore, FormDraftContext } from "../../hooks/useFormDraft";
import { clearAllSessionTourGuards } from "../../hooks/useOrgOnboarding";
import { supabase } from "../../config/supabase";
import API from "../../config/apiClient";
import { extractApiErrorDetails } from "../../config/sessionRecovery";
import AuthenticatorChallenge from "../auth/AuthenticatorChallenge";
import { getLoginRestriction } from "../../config/loginRestriction";
import {
  PersonalWorkspaceRouteSkeleton,
  WorkspaceRouteSkeleton,
  WorkspaceSidebarSkeleton,
} from "./WorkspaceSkeletons";

function PersonalWorkspaceShellSkeleton({ pathname, showSidebar = true }: {
  pathname: string;
  showSidebar?: boolean;
}) {
  const showOrganizationActions = !/^\/app\/(?:payments|settings)\/?$/i.test(pathname);

  return (
    <div className="min-h-dvh workspace-canvas text-primary flex flex-col font-body font-normal relative" aria-busy="true" aria-label="Loading personal workspace">
      <header className="app-navbar-surface h-14 border-b border-subtle bg-surface/95 backdrop-blur-md sticky top-0 z-40 px-3 md:px-6 flex flex-nowrap gap-2 sm:gap-3 items-center justify-between hardware-sharp relative">
        <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-subtle overflow-hidden z-50">
          <div className="animate-loading-bar bg-action" />
        </div>

        <div className="flex items-center gap-2.5 min-w-0 animate-pulse motion-reduce:animate-none">
          <div className="size-9 rounded-lg bg-skeleton md:hidden" />
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-skeleton" />
            <div className="hidden sm:block w-14 h-5 rounded-md bg-skeleton" />
          </div>
          <span className="text-muted shrink-0">/</span>
          <div className="h-4 w-28 rounded-sm bg-skeleton/80" />
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 animate-pulse motion-reduce:animate-none">
          {showOrganizationActions && (
            <div className="hidden md:flex items-center gap-2.5">
              <div className="h-9 w-36 rounded-full border border-subtle bg-surface" />
              <div className="h-9 w-40 rounded-full bg-skeleton" />
            </div>
          )}
          <div className="size-9 rounded-full bg-skeleton" />
          <div className="h-9 w-9 sm:w-28 rounded-full bg-elevated border border-subtle" />
        </div>
      </header>

      <div className="flex min-h-[calc(100dvh-3.5rem)]">
        {showSidebar && (
          <aside aria-hidden="true" className="hidden w-60 shrink-0 border-r border-subtle workspace-sidebar-surface px-2.5 pt-3 md:block motion-safe:animate-pulse">
            <div className="flex items-center gap-1.5">
              <div className="h-8 flex-1 rounded-lg border border-subtle bg-canvas" />
              <div className="size-8 rounded-lg bg-skeleton/50" />
            </div>
            <div className="space-y-4 px-2.5 pt-4">
              {[0, 1, 2].map(item => <div key={item} className="h-4 w-28 rounded bg-skeleton" />)}
            </div>
          </aside>
        )}
        <div className="min-w-0 flex-1">
          <PersonalWorkspaceRouteSkeleton pathname={pathname} />
        </div>
      </div>
    </div>
  );
}

function AuthenticatedWorkspace({ userId, children }: { userId: string; children: ReactNode }) {
  const { setTheme } = useTheme();
  const { data: preferences } = useQuery({
    queryKey: ["user-preferences", userId],
    queryFn: ({ signal }) => getUserPreferences({ expectedUserId: userId, signal }),
  });
  const savedTheme = preferences?.theme;
  useLayoutEffect(() => {
    if (savedTheme) setTheme(savedTheme);
  }, [savedTheme, setTheme]);
  const [draftStore] = useState(() => createFormDraftStore(userId));
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || session?.user.id !== userId) {
        draftStore.endSession();
        clearAllSessionTourGuards();
      }
    });
    return () => subscription.unsubscribe();
  }, [draftStore, userId]);
  const [idleWarning, setIdleWarning] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let checkingSession = false;
    let lastActivity = -Infinity;
    const recordActivity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible") return;
      if (event instanceof KeyboardEvent && event.repeat) return;
      const now = performance.now();
      if (now - lastActivity < 1000) return;
      lastActivity = now;
      void API.post("/user/session/activity", undefined, { signal: controller.signal }).catch(() => undefined);
    };
    const checkSession = () => {
      if (document.visibilityState === "visible") {
        if (checkingSession) return;
        checkingSession = true;
        void API.get("/user/session", { signal: controller.signal })
          .then(({ headers }) => {
            if (controller.signal.aborted) return;
            const value = headers["x-session-idle-remaining"];
            const seconds = value === undefined ? Infinity : Number(value);
            setIdleWarning(seconds >= 0 && seconds <= 60);
          })
          .catch(() => undefined)
          .finally(() => { checkingSession = false; });
      }
    };
    const actions = ["pointerdown", "keydown", "wheel"];
    for (const action of actions) {
      window.addEventListener(action, recordActivity, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", checkSession);
    const timer = window.setInterval(checkSession, 3000);
    checkSession();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkSession);
      for (const action of actions) window.removeEventListener(action, recordActivity, true);
    };
  }, [userId]);
  const client = useQueryClient();
  useEffect(() => () => {
    // Old observers can recreate empty entries while the new account is resolving.
    if (client.getQueryData<UserProfile | null>([AUTH])?.id !== userId) {
      client.removeQueries({ predicate: ({ queryKey }) => isFinancialScope(queryKey[2]) && queryKey[2].userId === userId });
    }
  }, [client, userId]);
  return (
    <FormDraftContext.Provider value={{ store: draftStore }}>
      {idleWarning && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 w-max max-w-[90vw] -translate-x-1/2 rounded-lg border border-amber-500/40 bg-surface px-4 py-3 text-sm text-primary shadow-lg">
          Your session will end within one minute if you stay idle.
        </div>
      )}
      {children}
    </FormDraftContext.Provider>
  );
}

const AppContainer = () => {
  const { user, isPending, isLoading, error, refetch } = useAuth();
  const location = useLocation();
  useLayoutEffect(notifySettingsRouteCommit, [location.key]);
  const loading = isPending || isLoading;
  const isOrgRoute = location.pathname.startsWith("/app/org/");
  const isPersonalRoute = /^\/(?:dashboard|app(?:\/(?:organizations|payments|settings))?)\/?$/i.test(location.pathname);

  if (loading) {
    if (isOrgRoute) {
      return (
        <div className="workspace-layout [--workspace-navbar-height:3.5rem] h-screen max-h-screen bg-canvas text-primary flex flex-col font-body font-normal relative overflow-hidden">
          <header className="app-navbar-surface h-(--workspace-navbar-height) shrink-0 border-b border-subtle bg-surface/95 sticky top-0 z-40 px-4 sm:px-6 flex items-center justify-between hardware-sharp relative backdrop-blur-md max-md:gap-2 max-md:px-3">
            <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-subtle overflow-hidden z-50">
              <div className="animate-loading-bar bg-action" />
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3 max-md:min-w-0 max-md:flex-1 max-md:gap-2 animate-pulse motion-reduce:animate-none">
              <div className="hidden items-center gap-2.5 shrink-0 md:flex">
                <div className="w-7 h-7 rounded-lg bg-skeleton" />
                <div className="w-14 h-5 rounded-md bg-skeleton" />
              </div>
              <span className="text-muted hidden md:inline">/</span>
              <div className="hidden md:block h-4 w-28 rounded-sm bg-skeleton/80 shrink-0" />
              <span className="hidden text-muted md:inline">/</span>
              <div className="size-9 shrink-0 md:hidden rounded-lg bg-elevated border border-subtle" />
              <div className="flex items-center gap-2 h-9 px-3 rounded-full bg-elevated border border-subtle max-md:flex-1 max-md:max-w-[260px]">
                <div className="w-6 h-6 max-md:size-5 rounded-md bg-skeleton shrink-0" />
                <div className="h-3.5 w-28 sm:w-36 rounded-sm bg-skeleton" />
                <div className="h-4 w-12 rounded-full bg-skeleton/70 ml-auto" />
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 animate-pulse motion-reduce:animate-none">
              <div className="hidden md:block h-9 w-36 rounded-full bg-elevated border border-subtle" />
              <div className="hidden md:block h-9 w-28 rounded-full bg-skeleton" />
              <div className="size-9 rounded-full bg-skeleton" />
              <div className="h-9 w-9 sm:w-28 rounded-full bg-elevated border border-subtle" />
            </div>
          </header>

          <div className="workspace-body flex-1 flex overflow-hidden min-h-0">
            <div className="hidden md:flex animate-pulse motion-reduce:animate-none">
              <WorkspaceSidebarSkeleton />
            </div>
            <main className="workspace-canvas workspace-gutters max-md:pb-24 flex-1 min-w-0 overflow-y-auto">
              <WorkspaceRouteSkeleton pathname={location.pathname} />
            </main>
          </div>
        </div>
      );
    }

    return <PersonalWorkspaceShellSkeleton pathname={location.pathname} showSidebar={isPersonalRoute} />;
  }

  if (error) {
    const restriction = getLoginRestriction(error);
    if (restriction) return <Navigate to="/login" replace state={{ restriction }} />;
    const details = extractApiErrorDetails(error);
    if (details.isTimeout) return <Navigate to="/login" replace state={{ sessionError: details.message }} />;
    if (extractApiErrorDetails(error).code === "mfa_required") {
      return <AuthenticatorChallenge onVerified={() => void refetch()} />;
    }
    return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6"><p role="alert">{formatErrorMessage(error)}</p><button className="underline" onClick={() => void refetch()}>Try again</button><button className="underline" onClick={() => void logout().catch(() => undefined).finally(() => window.location.assign('/login'))}>Return to sign in</button></main>;
  }

  if (user) {
    return (
      <AuthenticatedWorkspace key={user.id} userId={user.id}>
        <div className="min-h-screen workspace-canvas text-primary font-sans">
          <ProfileCompletionNotice user={user}/>
          {user.onboardingStep ? <AccountOnboarding user={user} /> : <RouteErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={isPersonalRoute
              ? <PersonalWorkspaceShellSkeleton pathname={location.pathname} />
              : <WorkspaceRouteSkeleton pathname={location.pathname} />}>
              <Outlet context={{ userId: user.id }} />
            </Suspense>
          </RouteErrorBoundary>}
        </div>
      </AuthenticatedWorkspace>
    );
  }

  return (
    <Navigate
      to="/login"
      replace
      state={{
        redirectUrl: location.pathname + location.search,
      }}
    />
  );
};

export default AppContainer;
