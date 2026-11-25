import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import type { MouseEvent } from "react";

let lastReadyWorkspace: string | undefined;
let pendingWorkspace: { scope: string; finish: () => void } | undefined;

function workspaceScope(pathname: string) {
  const orgId = /^\/app\/org\/([^/]+)/i.exec(pathname)?.[1];
  if (orgId) return `organization:${orgId.toLowerCase()}`;
  if (/^\/(?:dashboard|app(?:\/(?:organizations|payments|settings))?)\/?$/i.test(pathname)) return "personal";
}

export function isWorkspaceLinkClick(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented && event.button === 0 &&
    !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}

export function useWorkspaceNavigationReady(ready = true) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    const scope = workspaceScope(pathname);
    if (!ready || !scope) return;
    const previous = lastReadyWorkspace;
    lastReadyWorkspace = scope;
    if (pendingWorkspace?.scope === scope) {
      pendingWorkspace.finish();
      return;
    }
    if (!previous || previous === scope || navigationType !== "POP" ||
        !document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.hasAttribute("data-workspace-slide")) return;

    // Browser Back commits directly. Animate only the incoming navigation.
    const sidebar = document.querySelector<HTMLElement>(".workspace-transition-sidebar");
    if (!sidebar?.getClientRects().length) return;
    const animation = sidebar.animate([
      { opacity: 0, transform: "translateX(-6px)" },
      { opacity: 1, transform: "none" },
    ], { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    return () => animation.cancel();
  }, [navigationType, pathname, ready]);
}

let finishAppRouteUpdate: (() => void) | undefined;

export function notifyAppRouteCommit() {
  finishAppRouteUpdate?.();
}

/**
 * Performs a route navigation wrapped in the View Transitions API when available
 * and motion is enabled, allowing shared elements (like the navbar) to morph smoothly.
 */
export function navigateWithTransition(navigate: () => void, destination?: string) {
  const targetScope = destination && workspaceScope(destination);
  if (
    typeof document === "undefined" ||
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.hasAttribute("data-settings-slide") ||
    document.documentElement.hasAttribute("data-theme-reveal") ||
    document.documentElement.hasAttribute("data-workspace-slide")
  ) {
    navigate();
    return;
  }

  if (destination && (
    !targetScope || targetScope === workspaceScope(window.location.pathname) ||
    !window.matchMedia("(min-width: 48rem)").matches
  )) {
    navigate();
    return;
  }

  if (targetScope) {
    const root = document.documentElement;
    root.setAttribute("data-workspace-slide", "");
    const transition = document.startViewTransition(() => new Promise<void>((resolve, reject) => {
      const finish = () => {
        window.clearTimeout(timeout);
        pendingWorkspace = undefined;
        resolve();
      };
      const timeout = window.setTimeout(() => {
        transition.skipTransition();
        finish();
      }, 350);
      pendingWorkspace = { scope: targetScope, finish };
      try {
        navigate();
      } catch (error) {
        window.clearTimeout(timeout);
        pendingWorkspace = undefined;
        reject(error);
      }
    }));
    const cleanup = () => { root.removeAttribute("data-workspace-slide"); };
    void transition.finished.then(cleanup, cleanup);
    void transition.ready.catch(() => {});
    return;
  }

  document.startViewTransition(
    () =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          window.clearTimeout(timeout);
          finishAppRouteUpdate = undefined;
        };
        const finish = () => {
          cleanup();
          resolve();
        };
        const timeout = window.setTimeout(finish, 350);
        finishAppRouteUpdate = finish;
        try {
          navigate();
        } catch (error) {
          cleanup();
          reject(error);
        }
      }),
  );
}
