import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { HelpCircle, Lightbulb, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../../context/ThemeContext";
import useAuth, { AUTH, type UserProfile } from "../../hooks/useAuth";
import { updateUserPreferences } from "../../lib/api";
import { toast } from "../../lib/toast";

interface SidebarToolsProps {
  collapsed?: boolean;
  onFeedback?: () => void;
  onHelp: () => void;
}

export default function SidebarTools({ collapsed = false, onFeedback, onHelp }: SidebarToolsProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const saveTheme = useMutation({
    mutationFn: ({ theme, userId }: { theme: ThemePreference; userId: string }) =>
      updateUserPreferences({ theme }, { expectedUserId: userId }),
  });
  const appearanceOrigin = useRef<{ x: number; y: number } | null>(null);

  async function toggleAppearance(origin: { x: number; y: number }) {
    if (!user || saveTheme.isPending) return;
    const previous = theme;
    const next: ThemePreference = resolvedTheme === "dark" ? "light" : "dark";
    appearanceOrigin.current = origin;
    applyAppearance(next, origin);
    try {
      const preferences = await saveTheme.mutateAsync({ theme: next, userId: user.id });
      if (queryClient.getQueryData<UserProfile | null>([AUTH])?.id !== user.id) return;
      if (preferences.theme !== next) setTheme(preferences.theme);
      queryClient.setQueryData(["user-preferences", user.id], preferences);
    } catch {
      setTheme(previous);
      toast.error("Couldn’t save your appearance. Try again.");
    }
  }

  function applyAppearance(next: ThemePreference, origin: { x: number; y: number } | null) {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextResolved = next === "system" ? (prefersDark ? "dark" : "light") : next;

    if (!origin || nextResolved === resolvedTheme || !document.startViewTransition ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        root.hasAttribute("data-theme-reveal") || root.hasAttribute("data-settings-slide")) {
      setTheme(next);
      return;
    }

    const { x, y } = origin;
    const radius = Math.ceil(Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    ));
    root.style.setProperty("--theme-reveal-origin", `${x}px ${y}px`);
    root.style.setProperty("--theme-reveal-radius", `${radius}px`);
    root.setAttribute("data-theme-reveal", "");

    const transition = document.startViewTransition(() => {
      flushSync(() => {
        setTheme(next);
      });
    });
    const cleanup = () => {
      root.removeAttribute("data-theme-reveal");
      root.style.removeProperty("--theme-reveal-origin");
      root.style.removeProperty("--theme-reveal-radius");
    };
    void transition.finished.then(cleanup, cleanup);
  }

  const nextModeLabel = resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  const iconClass = "group grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary transition-colors hover:bg-hover-surface hover:text-primary focus-visible:ring-2 focus-visible:ring-strong";
  return (
    <div role="group" aria-label="Workspace tools" className={`flex shrink-0 border-t border-subtle p-2 ${collapsed ? "flex-col items-center" : "items-center gap-1"}`}>
      <button
        type="button"
        aria-label={nextModeLabel}
        title={nextModeLabel}
        disabled={saveTheme.isPending}
        className={`${iconClass} disabled:opacity-60`}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          void toggleAppearance({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
        }}
      >
        {resolvedTheme === "dark" ? (
          <Sun size={16} aria-hidden="true" className="sidebar-nav-icon transition-transform duration-200 ease-out group-hover:rotate-12 group-hover:scale-110" />
        ) : (
          <Moon size={16} aria-hidden="true" className="sidebar-nav-icon transition-transform duration-200 ease-out group-hover:-rotate-12 group-hover:scale-110" />
        )}
      </button>
      <Link to="/contact" aria-label="Feedback" title="Feedback"
        className={`${iconClass} ${collapsed ? "" : "ml-auto"}`} onClick={onFeedback}>
        <Lightbulb size={16} aria-hidden="true" className="sidebar-nav-icon transition-transform duration-200 ease-out group-hover:-rotate-12 group-hover:scale-110" />
      </Link>
      <button type="button" aria-label="Help" title="Help" className={iconClass} onClick={onHelp}>
        <HelpCircle size={16} aria-hidden="true" className="sidebar-nav-icon transition-transform duration-200 ease-out group-hover:rotate-12 group-hover:scale-110" />
      </button>
    </div>
  );
}
