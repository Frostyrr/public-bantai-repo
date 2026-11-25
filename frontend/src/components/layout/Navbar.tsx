import React, { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  Moon,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import useAuth from "../../hooks/useAuth";
import { useTheme } from "../../context/ThemeContext";
import BantaiLogo from "../ui/BantaiLogo";
import { navigateWithTransition } from "../../utils/navTransition";

interface NavDropdownCard {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  motif: "bars" | "grid" | "arcs";
}

interface NavDropdownProps {
  id: string;
  order: number;
  label: string;
  items: readonly (readonly [string, string])[];
  preview?: NavDropdownCard;
  mobileExtra?: readonly [string, string];
  align?: "left" | "right" | "center";
  sharedMenu?: {
    activeId: string | null;
    direction: "left" | "right" | null;
    open: (id: string, order: number) => void;
    scheduleClose: (id: string) => void;
    closeNow: (id?: string) => void;
  };
}

function CardMotif({ motif }: { motif: NavDropdownCard["motif"] }) {
  if (motif === "bars") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 120 120"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full opacity-45 transition-opacity duration-200 group-hover/card:opacity-80"
        fill="none"
      >
        <defs>
          <linearGradient id="nav-bar-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </linearGradient>
        </defs>
        <line
          x1="22"
          y1="78"
          x2="22"
          y2="120"
          stroke="url(#nav-bar-fade)"
          strokeWidth="1.5"
        />
        <line
          x1="48"
          y1="42"
          x2="48"
          y2="120"
          stroke="url(#nav-bar-fade)"
          strokeWidth="1.5"
        />
        <line
          x1="74"
          y1="62"
          x2="74"
          y2="120"
          stroke="url(#nav-bar-fade)"
          strokeWidth="1.5"
        />
        <line
          x1="100"
          y1="30"
          x2="100"
          y2="120"
          stroke="url(#nav-bar-fade)"
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  if (motif === "grid") {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-35 transition-opacity duration-200 group-hover/card:opacity-65 bg-[linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:14px_14px] [mask-image:radial-gradient(ellipse_at_bottom_right,black_30%,transparent_80%)]"
      />
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 140 80"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-40 transition-opacity duration-200 group-hover/card:opacity-75"
      fill="none"
    >
      <circle
        cx="95"
        cy="92"
        r="34"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
      />
      <circle
        cx="95"
        cy="92"
        r="56"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="1"
        strokeDasharray="3 4"
      />
      <circle
        cx="95"
        cy="92"
        r="78"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="1"
      />
    </svg>
  );
}

function NavDropdown({
  id,
  order,
  label,
  items,
  preview,
  mobileExtra,
  align = "left",
  sharedMenu,
}: NavDropdownProps) {
  const linksId = useId();
  const group = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const { key } = useLocation();
  const [openKey, setOpenKey] = useState<string>();
  const expanded = sharedMenu ? sharedMenu.activeId === id : openKey === key;

  const cancelClose = () => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };

  const openMenu = () => {
    if (sharedMenu) {
      sharedMenu.open(id, order);
      return;
    }
    cancelClose();
    setOpenKey(key);
  };

  const scheduleClose = () => {
    if (sharedMenu) {
      sharedMenu.scheduleClose(id);
      return;
    }
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpenKey(undefined);
    }, 90);
  };

  const closeImmediately = () => {
    if (sharedMenu) {
      sharedMenu.closeNow(id);
      return;
    }
    cancelClose();
    setOpenKey(undefined);
  };

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !group.current?.contains(event.target)
      )
        closeImmediately();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  });

  const positionClass =
    align === "right"
      ? "right-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "left-0";

  const originClass =
    align === "right"
      ? "origin-top-right"
      : align === "center"
        ? "origin-top"
        : "origin-top-left";

  return (
    <div
      ref={group}
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          closeImmediately();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          closeImmediately();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={expanded}
        aria-controls={linksId}
        className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-xs sm:text-sm transition-colors focus-visible:outline-2 ${
          expanded
            ? "bg-elevated text-primary dark:bg-white/[0.08] dark:text-white"
            : "text-secondary hover:bg-elevated/70 hover:text-primary dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
        }`}
        onClick={() => {
          if (expanded) closeImmediately();
          else openMenu();
        }}
      >
        {label}{" "}
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`absolute top-full pt-2.5 ${positionClass} ${
          expanded ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <div
          id={linksId}
          aria-hidden={!expanded}
          className={`${
            preview ? "w-[390px] p-3" : "w-52 max-w-[calc(100vw-2rem)] p-1.5"
          } rounded-2xl border border-subtle dark:border-zinc-800/90 bg-surface/95 dark:bg-zinc-950/95 shadow-xl dark:shadow-[0_20px_48px_-12px_rgba(0,0,0,0.95)] backdrop-blur-xl transition-[transform,opacity,visibility] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity] motion-reduce:transition-none ${originClass} ${
            expanded
              ? sharedMenu?.direction === "right"
                ? "animate-nav-from-right opacity-100 scale-100 translate-y-0 visible"
                : sharedMenu?.direction === "left"
                  ? "animate-nav-from-left opacity-100 scale-100 translate-y-0 visible"
                  : "opacity-100 scale-100 translate-x-0 translate-y-0 visible"
              : sharedMenu?.direction === "right"
                ? "opacity-0 -translate-x-4 translate-y-0 invisible"
                : sharedMenu?.direction === "left"
                  ? "opacity-0 translate-x-4 translate-y-0 invisible"
                  : "opacity-0 scale-95 -translate-y-1.5 invisible"
          }`}
        >
          {preview ? (
            <div className="grid grid-cols-[136px_1fr] gap-3">
              <ul className="flex flex-col justify-start gap-0.5 py-0.5">
                {items.map(([to, itemLabel]) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      tabIndex={expanded ? 0 : -1}
                      onClick={closeImmediately}
                      className="flex items-center rounded-xl px-3 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-2 aria-[current=page]:bg-elevated aria-[current=page]:text-primary"
                    >
                      {itemLabel}
                    </NavLink>
                  </li>
                ))}
              </ul>

              {(() => {
                const PreviewIcon = preview.icon;
                return (
                  <NavLink
                    to={preview.to}
                    tabIndex={expanded ? 0 : -1}
                    onClick={closeImmediately}
                    className="group/card relative flex min-h-[124px] flex-col justify-between overflow-hidden rounded-xl border border-subtle bg-elevated/60 p-3.5 transition-colors hover:border-strong hover:bg-elevated focus-visible:outline-2"
                  >
                    <div className="relative z-10 flex size-7 items-center justify-center rounded-lg border border-subtle bg-surface text-secondary transition-colors group-hover/card:border-strong group-hover/card:text-primary">
                      <PreviewIcon className="size-3.5" aria-hidden="true" />
                    </div>
                    <div className="relative z-10 mt-3 space-y-1">
                      <div className="text-[13px] font-medium text-primary">
                        {preview.title}
                      </div>
                      <p className="text-[11px] leading-relaxed text-secondary">
                        {preview.description}
                      </p>
                    </div>
                    <CardMotif motif={preview.motif} />
                  </NavLink>
                );
              })()}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {items.map(([to, itemLabel]) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    tabIndex={expanded ? 0 : -1}
                    onClick={closeImmediately}
                    className="flex items-center rounded-xl px-3 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-2 aria-[current=page]:bg-elevated aria-[current=page]:text-primary"
                  >
                    {itemLabel}
                  </NavLink>
                </li>
              ))}
              {mobileExtra && (
                <li className="mt-1.5 border-t border-subtle pt-1.5 sm:hidden">
                  <NavLink
                    to={mobileExtra[0]}
                    tabIndex={expanded ? 0 : -1}
                    onClick={closeImmediately}
                    className="flex items-center rounded-xl px-3 py-2 text-[13px] font-medium text-primary transition-colors hover:bg-elevated focus-visible:outline-2"
                  >
                    {mobileExtra[1]}
                  </NavLink>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const ABOUT_ITEMS = [
  ["/about", "About Bantai"],
  ["/story", "Our Story"],
] as const;

const MOBILE_MENU_ITEMS = [
  ["/#top", "Home"],
  ["/about", "About Bantai"],
  ["/story", "Our Story"],
  ["/#features", "Features"],
  ["/bani", "How Bani Works"],
  ["/#accountability", "How it works"],
  ["/subscriptions", "Pricing"],
  ["/#faq", "FAQ"],
] as const;

const ABOUT_PREVIEW: NavDropdownCard = {
  to: "/story",
  title: "Our Story",
  description: "Why we built transparent financial governance.",
  icon: BookOpen,
  motif: "grid",
};

const FEATURES_ITEMS = [
  ["/#features", "Features"],
  ["/#bani", "Meet Bani"],
  ["/bani", "How Bani Works"],
] as const;

const FEATURES_PREVIEW: NavDropdownCard = {
  to: "/bani",
  title: "How Bani Works",
  description: "See how Bani queries your ledger, respects roles, and protects records.",
  icon: Sparkles,
  motif: "bars",
};

export const Navbar: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname, hash, key } = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  const toggleTheme = (origin: { x: number; y: number } | null) => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    if (
      !origin ||
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      root.hasAttribute("data-theme-reveal") ||
      root.hasAttribute("data-settings-slide")
    ) {
      setTheme(next);
      return;
    }
    const { x, y } = origin;
    const radius = Math.ceil(
      Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)),
    );
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
  };
  const [menuState, setMenuState] = useState<{
    key: string;
    activeId: string | null;
    order: number | null;
    direction: "left" | "right" | null;
  }>({ key, activeId: null, order: null, direction: null });
  const sharedCloseTimer = useRef<number | undefined>(undefined);

  const activeMenuId = menuState.key === key ? menuState.activeId : null;
  const activeDirection = menuState.key === key ? menuState.direction : null;

  const sharedMenu = {
    activeId: activeMenuId,
    direction: activeDirection,
    open: (id: string, order: number) => {
      if (sharedCloseTimer.current !== undefined) {
        window.clearTimeout(sharedCloseTimer.current);
        sharedCloseTimer.current = undefined;
      }
      setMenuState((prev) => {
        const prevActive = prev.key === key ? prev.activeId : null;
        const prevOrder = prev.key === key ? prev.order : null;
        if (prevActive === id) return prev;
        const direction =
          prevActive && prevOrder !== null
            ? order > prevOrder
              ? "right"
              : "left"
            : null;
        return { key, activeId: id, order, direction };
      });
    },
    scheduleClose: (id: string) => {
      if (sharedCloseTimer.current !== undefined) {
        window.clearTimeout(sharedCloseTimer.current);
      }
      sharedCloseTimer.current = window.setTimeout(() => {
        setMenuState((prev) =>
          prev.activeId === id ? { key, activeId: null, order: null, direction: null } : prev,
        );
      }, 110);
    },
    closeNow: (id?: string) => {
      if (sharedCloseTimer.current !== undefined) {
        window.clearTimeout(sharedCloseTimer.current);
        sharedCloseTimer.current = undefined;
      }
      setMenuState((prev) =>
        !id || prev.activeId === id
          ? { key, activeId: null, order: null, direction: null }
          : prev,
      );
    },
  };

  useEffect(
    () => () => {
      if (sharedCloseTimer.current !== undefined) {
        window.clearTimeout(sharedCloseTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 25);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="fixed top-3 sm:top-5 inset-x-0 z-50 flex justify-center px-3 sm:px-6 pointer-events-none font-body font-normal motion-safe:animate-navbar-entrance">
      <div
        className={`app-navbar-surface pointer-events-auto w-full max-w-6xl xl:max-w-7xl px-3 sm:px-7 rounded-full transition-all duration-300 flex items-center justify-between hardware-sharp border border-subtle dark:border-white/[0.11] backdrop-blur-md shadow-lg dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_16px_40px_-12px_rgba(0,0,0,0.9)] motion-reduce:transition-none ${
          scrolled
            ? "h-13 sm:h-16 bg-surface/95 dark:bg-zinc-950/90"
            : "h-14 sm:h-[4.25rem] bg-surface/80 dark:bg-zinc-950/75"
        }`}
      >
        {/* Left Branding: Bantai in Cabinet Grotesk medium */}
        <Link
          to="/#top"
          aria-label="Bantai home"
          className="app-brand-mark flex shrink-0 items-center gap-1.5 sm:gap-3 group focus-visible:outline-2"
        >
          <BantaiLogo
            className="w-6 h-6 sm:w-8 sm:h-8 group-hover:scale-105 transition-transform"
          />
          <span className="font-heading font-medium text-base sm:text-xl tracking-tight text-primary group-hover:text-secondary transition-colors">
            Bantai
          </span>
        </Link>

        {/* Center Navigation Links in Geist regular */}
        <nav className="hidden lg:flex items-center gap-1 sm:gap-2 lg:gap-2.5 font-body font-normal text-sm text-secondary">
          <Link
            to="/#top"
            aria-current={
              pathname === "/" && (!hash || hash === "#top")
                ? "page"
                : undefined
            }
            className="rounded-full px-3 py-1.5 transition-colors hover:text-primary focus-visible:outline-2 aria-[current=page]:font-medium aria-[current=page]:text-primary"
          >
            Home
          </Link>
          <NavDropdown
            id="about"
            order={0}
            label="About"
            items={ABOUT_ITEMS}
            preview={ABOUT_PREVIEW}
            align="left"
            sharedMenu={sharedMenu}
          />
          <NavDropdown
            id="features"
            order={1}
            label="Features"
            items={FEATURES_ITEMS}
            preview={FEATURES_PREVIEW}
            align="left"
            sharedMenu={sharedMenu}
          />
          <Link
            to="/#accountability"
            aria-current={
              pathname === "/" && hash === "#accountability"
                ? "page"
                : undefined
            }
            className="rounded-full px-3 py-1.5 transition-colors hover:text-primary focus-visible:outline-2 aria-[current=page]:font-medium aria-[current=page]:text-primary"
          >
            How it works
          </Link>
          <Link
            to="/subscriptions"
            aria-current={pathname === "/subscriptions" ? "page" : undefined}
            className="rounded-full px-3 py-1.5 transition-colors hover:text-primary focus-visible:outline-2 aria-[current=page]:font-medium aria-[current=page]:text-primary"
          >
            Pricing
          </Link>
          <Link
            to="/#faq"
            aria-current={
              pathname === "/" && hash === "#faq" ? "page" : undefined
            }
            className="rounded-full px-3 py-1.5 transition-colors hover:text-primary focus-visible:outline-2 aria-[current=page]:font-medium aria-[current=page]:text-primary"
          >
            FAQ
          </Link>
        </nav>

        {/* Right Navigation Actions */}
        <nav
          aria-label="About and account"
          className="flex items-center gap-1.5 sm:gap-2.5 font-body font-normal"
        >
          <button
            type="button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              toggleTheme(
                rect.width && rect.height
                  ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                  : null,
              );
            }}
            aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-subtle bg-elevated/70 text-secondary transition-colors hover:border-strong hover:text-primary focus-visible:outline-2"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="size-3.5" aria-hidden="true" />
            ) : (
              <Moon className="size-3.5" aria-hidden="true" />
            )}
          </button>
          <div className="lg:hidden">
            <NavDropdown
              id="mobile-menu"
              order={0}
              label="Menu"
              items={MOBILE_MENU_ITEMS}
              mobileExtra={!user ? ["/login", "Log in"] : undefined}
              align="right"
            />
          </div>
          {!user && (
            <Link
              to="/login"
              className="hidden sm:inline-flex whitespace-nowrap rounded-full px-3.5 py-2 text-sm text-secondary transition-colors hover:text-primary"
            >
              Log in
            </Link>
          )}
          <Link
            to={user ? "/dashboard" : "/register"}
            onClick={(e) => {
              if (!user) return;
              e.preventDefault();
              navigateWithTransition(() => navigate("/dashboard"));
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-action px-3 sm:px-3.5 text-xs font-medium text-action-fg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
          >
            {user ? "Dashboard" : "Get started"}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
