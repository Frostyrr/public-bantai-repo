import ScrollReveal from '../ui/ScrollReveal';
import { useState } from "react";
import {
  Archive,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckSquare,
  CircleCheck,
  CreditCard,
  FileCheck,
  FolderKanban,
  HandCoins,
  History,
  LayoutDashboard,
  PieChart,
  Receipt,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import useAuth from "../../hooks/useAuth";
import { BantaiLogo } from "../ui/BantaiLogo";
import baniIcon from "../../assets/Bani 4.png";
import Button from "../ui/Button";
import Badge from "../ui/Badge";

const views = ["Overview", "Cash Advances", "Ask Bani"] as const;
type PreviewView = (typeof views)[number];

const navigation = [
  {
    label: "Workspace",
    links: [
      ["Overview", LayoutDashboard],
      ["My Contributions", Receipt],
      ["Projects", FolderKanban],
    ],
  },
  {
    label: "Finances",
    links: [
      ["Collections", Receipt],
      ["Budgets", PieChart],
      ["Expenses", CreditCard],
      ["Approvals", CheckSquare],
      ["Reimbursements", HandCoins],
      ["Cash Advances", FileCheck],
      ["Reports", BarChart3],
    ],
  },
  {
    label: "Organization",
    links: [
      ["Member Directory", Users],
      ["Workspace Access", ShieldCheck],
      ["Archives", Archive],
      ["Audit Logs", History],
      ["Settings", Settings],
    ],
  },
] as const;

const rightWidgets = [
  {
    title: "Active Collections & Dues",
    Icon: Receipt,
    subtitle: "Semestral Membership Fee",
    meta: "75% collected",
    progress: 75,
  },
  {
    title: "Cash Advances & Float",
    Icon: FileCheck,
    subtitle: "1 outstanding float",
    meta: "PHP 5,000.00",
    progress: 40,
  },
  {
    title: "Budget Utilization",
    Icon: PieChart,
    subtitle: "General Assembly",
    meta: "64.6% used",
    progress: 65,
  },
  {
    title: "Pending Approvals",
    Icon: CheckSquare,
    subtitle: "2 items awaiting review",
    meta: "Action needed",
    progress: null,
  },
] as const;

const metrics = [
  ["Treasury Reserve", "PHP 95,000.00", Wallet],
  ["Collected", "PHP 142,500.00", TrendingUp],
  ["Budgets", "PHP 95,000.00", PieChart],
  ["Expenses", "PHP 47,500.00", CreditCard],
  ["Advances", "PHP 5,000.00", FileCheck],
] as const;

const advances = [
  ["Event Logistics Cash Advance", "PHP 5,000.00", "Outstanding", "warning"],
  ["Volunteer Meals Cash Advance", "PHP 3,500.00", "Liquidated", "success"],
] as const;

const activity = [
  ["General Assembly Venue & Sound", "PHP 12,000.00", "Approved", "success"],
  ["1st Semester Membership Dues", "PHP 45,000.00", "Collected", "success"],
  ...advances,
] as const;

const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-subtle px-2.5 py-1.5 whitespace-nowrap";
const interactive =
  "cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white";

function DashboardPreview() {
  const [view, setView] = useState<PreviewView>("Overview");

  return (
    <figure
      className="relative isolate mx-auto mt-14 w-full max-w-6xl overflow-visible text-left"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "j"
        ) {
          event.preventDefault();
          setView((current) =>
            current === "Ask Bani" ? "Overview" : "Ask Bani",
          );
        }
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-44 left-1/2 z-0 hidden h-48 w-[130%] -translate-x-1/2 dark:block"
        style={{ background: "radial-gradient(48% 85% at 50% 100%, rgba(255,255,255,0.22) 0%, rgba(228,228,231,0.11) 28%, rgba(161,161,170,0.04) 55%, rgba(5,5,7,0) 100%)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 left-1/2 z-0 hidden h-20 w-[65%] -translate-x-1/2 dark:block"
        style={{ background: "radial-gradient(50% 100% at 50% 100%, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.08) 45%, rgba(5,5,7,0) 100%)" }}
      />
      <div className="card-specular z-10 rounded-b-none border-b-0 border-x-black/10 border-t-black/10 dark:border-x-white/20 dark:border-t-white/20 before:inset-x-12 before:via-black/15 dark:before:via-white/65 [mask-image:linear-gradient(to_bottom,black_62%,transparent_100%)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-subtle px-3 py-3 text-xs sm:px-4">
          <div className="flex flex-wrap items-center gap-2 text-muted">
            <span className="flex items-center gap-1.5 font-medium text-primary">
              <BantaiLogo className="size-4 object-contain" alt="" />
              Bantai
            </span>
            <span aria-hidden="true">/</span>
            <span className="hidden sm:inline">My Organizations</span>
            <span className="hidden sm:inline" aria-hidden="true">
              /
            </span>
            <span className="font-medium text-primary">Metro Chapter</span>
            <Badge variant="success">Owner</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-secondary">
            <span className={pill}>
              <CalendarDays size={13} aria-hidden="true" />
              AY 2026–2027
            </span>
            <button
              type="button"
              aria-keyshortcuts="Control+J Meta+J"
              aria-pressed={view === "Ask Bani"}
              onClick={() =>
                setView(view === "Ask Bani" ? "Overview" : "Ask Bani")
              }
              className={
                pill +
                " " +
                interactive +
                " bg-action font-medium text-action-fg hover:opacity-90"
              }
            >
              <Sparkles size={14} aria-hidden="true" />
              Ask Bani
            </button>
            <span className={pill} aria-label="Jamie Reyes">
              <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-primary">
                U
              </span>
              <span className="hidden lg:inline">You</span>
            </span>
          </div>
        </div>
        <div className="flex">
          <aside
            aria-label="Preview workspace navigation"
            className="hidden w-48 shrink-0 flex-col gap-4 border-r border-subtle bg-canvas/70 dark:bg-[#0B0B0E] p-3 md:flex"
          >
            {navigation.map(({ label, links }) => (
              <div key={label}>
                <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                  {label}
                </p>
                <ul className="space-y-0.5">
                  {links.map(([name, Icon]) => {
                    const isSwitchable = name === "Overview" || name === "Cash Advances";
                    const isActive = name === view;
                    const itemClass =
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left transition-colors " +
                      (isActive
                        ? "bg-selected-surface text-primary font-medium"
                        : isSwitchable
                        ? "cursor-pointer text-secondary hover:bg-elevated hover:text-primary"
                        : "text-muted");
                    return (
                      <li key={name}>
                        {isSwitchable ? (
                          <button
                            type="button"
                            onClick={() => setView(name)}
                            aria-current={isActive ? "page" : undefined}
                            className={itemClass}
                          >
                            <Icon size={14} aria-hidden="true" />
                            {name}
                          </button>
                        ) : (
                          <span className={itemClass}>
                            <Icon size={14} aria-hidden="true" />
                            {name}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </aside>
          <div className="min-w-0 flex-1 px-3 pb-28 pt-4 sm:px-5">
            <div
              role="group"
              aria-label="Explore workspace views"
              className="mb-4 flex flex-wrap gap-1 border-b border-subtle pb-2 md:hidden"
            >
              {views.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={name === view}
                  onClick={() => setView(name)}
                  className={
                    interactive +
                    " rounded-md px-2.5 py-1.5 text-xs font-medium hover:bg-elevated " +
                    (name === view ? "bg-selected-surface text-primary" : "text-muted")
                  }
                >
                  {name}
                </button>
              ))}
            </div>
            <div key={view} aria-live="polite" className="animate-insight-swap">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-heading text-xl font-medium text-primary">
                  {view}
                </h2>
                {view === "Ask Bani" && (
                  <button
                    type="button"
                    onClick={() => setView("Overview")}
                    className="cursor-pointer text-xs text-muted hover:text-primary transition-colors"
                  >
                    Back to Overview
                  </button>
                )}
              </div>
              {view === "Overview" && (
                <>
                  <div className="mb-3.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {metrics.map(([label, amount, Icon], index) => (
                      <div
                        key={label}
                        className={`rounded-xl border border-subtle bg-surface dark:bg-[#111114] p-2.5 ${
                          index === 0 ? "col-span-2 sm:col-span-1" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 font-mono text-[9px] uppercase tracking-wider text-muted">
                          <span className="truncate">{label}</span>
                          <Icon
                            size={12}
                            className="shrink-0 text-muted"
                            aria-hidden="true"
                          />
                        </div>
                        <p className="mt-1.5 whitespace-nowrap text-xs font-medium tabular-nums text-primary sm:text-sm">
                          {amount}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {view === "Ask Bani" ? (
                <div className="space-y-3 rounded-xl border border-subtle bg-surface dark:bg-[#111114] p-4 text-sm">
                  <p className="text-secondary">
                    Which cash advances still need to be liquidated?
                  </p>
                  <div className="flex items-start gap-2 rounded-lg border border-subtle bg-elevated p-3 text-primary">
                    <Sparkles
                      size={15}
                      className="mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    <p>
                      Metro Chapter has one outstanding cash advance. Event
                      Logistics still needs to account for{" "}
                      <strong className="whitespace-nowrap font-medium text-primary">
                        PHP 5,000.00
                      </strong>
                      .
                    </p>
                  </div>
                </div>
              ) : view === "Overview" ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[200px_minmax(0,1fr)_215px] items-start">
                  {/* Left Column: Bani Insights */}
                  <div className="flex flex-col justify-between rounded-xl border border-subtle bg-gradient-to-b from-surface to-canvas dark:border-white/15 dark:from-[#141418] dark:to-[#09090B] p-3.5">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="size-6 shrink-0 rounded-lg border border-subtle bg-elevated dark:border-white/15 dark:bg-gradient-to-b dark:from-zinc-800 dark:to-zinc-950 p-1">
                            <img src={baniIcon} alt="" className="size-full object-contain grayscale invert dark:invert-0" />
                          </span>
                          <span className="text-xs font-medium text-primary">Bani Insights</span>
                        </div>
                        <span className="rounded-full border border-subtle bg-elevated px-1.5 py-0.5 text-[9px] text-secondary">
                          1 insight
                        </span>
                      </div>
                      <p className="mt-2.5 text-[11px] leading-relaxed text-secondary">
                        Event Logistics has an outstanding{" "}
                        <span className="font-medium tabular-nums text-primary">PHP 5,000.00</span>{" "}
                        cash advance awaiting liquidation.
                      </p>
                      <div className="mt-3 space-y-1.5 border-t border-subtle pt-2.5 text-[10px] text-muted">
                        <div className="flex items-center justify-between">
                          <span>Active period</span>
                          <span className="font-mono text-primary">AY 25–26</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Pending approvals</span>
                          <span className="font-mono text-primary">2 items</span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setView("Ask Bani")}
                      className="mt-3 inline-flex w-full cursor-pointer items-center justify-between rounded-lg border border-subtle bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:border-strong"
                    >
                      <span>Ask Bani</span>
                      <ArrowRight size={11} aria-hidden="true" />
                    </button>
                  </div>

                  {/* Center Column: Financial Activity */}
                  <div className="rounded-xl border border-subtle bg-surface dark:bg-[#111114]">
                    <div className="flex items-center justify-between border-b border-subtle px-3.5 py-2.5">
                      <h3 className="text-xs font-medium text-primary">Financial Activity</h3>
                      <span className="font-mono text-[10px] text-muted">Live ledger</span>
                    </div>
                    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {activity.map(([name, amount, status, variant]) => (
                        <li
                          key={name}
                          className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 px-3.5 py-2.5 text-xs sm:grid-cols-[1fr_auto_84px]"
                        >
                          <span className="col-span-2 flex items-center gap-2 truncate text-primary sm:col-span-1">
                            <CircleCheck
                              size={12}
                              className="shrink-0 text-muted"
                              aria-hidden="true"
                            />
                            <span className="truncate">{name}</span>
                          </span>
                          <span className="whitespace-nowrap tabular-nums text-secondary">
                            {amount}
                          </span>
                          <Badge variant={variant} className="justify-self-end">
                            {status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Right Column: 4 Operational Widgets */}
                  <div className="hidden space-y-2 lg:block">
                    {rightWidgets.map(({ title, Icon, subtitle, meta, progress }) => (
                      <div
                        key={title}
                        className="rounded-xl border border-subtle bg-surface dark:bg-[#111114] p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="grid size-5 shrink-0 place-items-center rounded-md border border-subtle bg-elevated text-muted">
                              <Icon size={11} aria-hidden="true" />
                            </span>
                            <span className="truncate text-[11px] font-medium text-primary">
                              {title}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                          <span className="truncate text-muted">{subtitle}</span>
                          <span className="shrink-0 font-mono text-primary tabular-nums">{meta}</span>
                        </div>
                        {progress !== null && (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-progress-track">
                            <div
                              className="h-full rounded-full bg-zinc-900 dark:bg-zinc-300"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-subtle bg-surface dark:bg-[#111114]">
                  <h3 className="border-b border-subtle px-3.5 py-3 text-xs font-medium text-primary">
                    Cash Advance Register
                  </h3>
                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {advances.map(
                      ([name, amount, status, variant]) => (
                        <li
                          key={name}
                          className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 px-3.5 py-2.5 text-xs sm:grid-cols-[1fr_auto_96px]"
                        >
                          <span className="col-span-2 flex items-center gap-2 text-primary sm:col-span-1">
                            <CircleCheck
                              size={13}
                              className="shrink-0 text-muted"
                              aria-hidden="true"
                            />
                            {name}
                          </span>
                          <span className="whitespace-nowrap tabular-nums text-secondary">
                            {amount}
                          </span>
                          <Badge variant={variant} className="justify-self-end">
                            {status}
                          </Badge>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-36 bg-linear-to-t from-canvas via-canvas/80 to-transparent" />
      </div>
    </figure>
  );
}

export function Hero() {
  const { user } = useAuth();

  return (
    <section
      id="top"
      tabIndex={-1}
      className="relative isolate overflow-hidden px-4 pt-28 text-center sm:px-6 md:pt-36"
    >
      {/* Top Monochrome Ambient Spotlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-30 h-[420px] bg-[radial-gradient(55%_55%_at_50%_0%,rgba(0,0,0,0.045)_0%,rgba(0,0,0,0.015)_45%,transparent_100%)] dark:bg-[radial-gradient(55%_55%_at_50%_0%,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_45%,transparent_100%)]"
      />
      {/* Wider Centered Monochrome Vertical Lines (128px spacing) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(to_right,rgba(0,0,0,0.055)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[length:128px_100%] bg-[position:50%_0] [mask-image:radial-gradient(ellipse_78%_68%_at_50%_38%,black_20%,transparent_100%)]"
      />
      {/* Animated Monochrome Vertical Light Beams Aligned to the 128px Lines */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_75%_65%_at_50%_40%,black_25%,transparent_100%)]"
      >
        <span
          className="animate-grid-beam-y absolute left-[calc(50%-256px)] top-12 h-32 w-px bg-gradient-to-b from-transparent via-zinc-900/35 dark:via-white/70 to-transparent"
          style={{ animationDelay: "0s" }}
        />
        <span
          className="animate-grid-beam-y absolute left-[calc(50%-128px)] top-24 h-40 w-px bg-gradient-to-b from-transparent via-zinc-900/45 dark:via-white/85 to-transparent"
          style={{ animationDelay: "1.6s" }}
        />
        <span
          className="animate-grid-beam-y absolute left-[calc(50%+128px)] top-16 h-36 w-px bg-gradient-to-b from-transparent via-zinc-900/40 dark:via-white/80 to-transparent"
          style={{ animationDelay: "0.8s" }}
        />
        <span
          className="animate-grid-beam-y absolute left-[calc(50%+256px)] top-28 h-28 w-px bg-gradient-to-b from-transparent via-zinc-900/30 dark:via-white/65 to-transparent"
          style={{ animationDelay: "2.5s" }}
        />
      </div>
      <div className="relative z-10">
        <ScrollReveal delay={0}>
          <h1 className="mx-auto mt-6 max-w-4xl text-[2.1rem] leading-[1.08] tracking-[-0.03em] sm:text-5xl md:text-[62px]">
            <span className="text-display-gradient">Every centavo accounted for.
            <br />Zero guesswork.</span>
          </h1>
        </ScrollReveal>
        <ScrollReveal delay={95}>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-secondary sm:text-base md:text-lg">
            Track member contributions, organize budgets, and review expenses in one
            shared workspace for your organization.
          </p>
        </ScrollReveal>
        <ScrollReveal delay={145}>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              variant="primary"
              to={user ? "/dashboard" : "/register"}
              className="w-full max-w-xs sm:w-auto sm:max-w-none justify-center rounded-full bg-action px-6 text-action-fg shadow-md dark:shadow-[0_0_24px_-6px_rgba(255,255,255,0.45)] hover:opacity-90"
              iconRight={<ArrowRight size={16} aria-hidden="true" />}
            >
              {user ? "Open dashboard" : "Create an account"}
            </Button>
            <Button
              variant="secondary"
              to="/#accountability"
              className="w-full max-w-xs sm:w-auto sm:max-w-none justify-center rounded-full border border-subtle bg-surface/80 px-6 text-primary hover:bg-elevated dark:border-white/15 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/[0.08]"
            >
              See How It Works
            </Button>
          </div>
        </ScrollReveal>
        <ScrollReveal delay={210}>
          <a
            href="#bani"
            className={
              interactive +
              " mt-5 inline-flex items-center justify-center gap-2 rounded-md py-2 text-sm text-secondary hover:text-primary"
            }
          >
            <Sparkles size={15} className="shrink-0" aria-hidden="true" />
            Meet Bani, your AI financial assistant
            <ArrowRight size={14} className="shrink-0" aria-hidden="true" />
          </a>
        </ScrollReveal>
      </div>
      <ScrollReveal delay={260} className="relative z-0">
        <DashboardPreview />
      </ScrollReveal>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-gradient-to-b from-transparent to-canvas"
      />
    </section>
  );
}

export default Hero;
