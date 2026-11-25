import { useState } from "react";
import {
  Briefcase,
  Building2,
  Check,
  GraduationCap,
  HeartHandshake,
  ShieldCheck,
  Users,
} from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import HairlineGrid from "../../components/ui/HairlineGrid";
import RimDivider from "../../components/ui/RimDivider";
import ScrollReveal from "../../components/ui/ScrollReveal";
import { EditorialLink } from "../../components/layout/EditorialPage";

const capabilities = [
  [
    "Organize contributions",
    "Track what members owe and what they’ve paid across collections.",
  ],
  [
    "Plan and track spending",
    "Allocate budgets, record expenses with supporting evidence, and track cash advances through settlement.",
  ],
  [
    "Make decisions traceable",
    "Keep approvals and audit records alongside the financial activity they describe.",
  ],
  [
    "Share financial information",
    "Give stakeholders a clearer view through reports and appropriate access.",
  ],
] as const;

const audiences = [
  { label: "Student Organizations", icon: GraduationCap },
  { label: "Clubs & Societies", icon: Users },
  { label: "Associations", icon: Building2 },
  { label: "Community Groups", icon: HeartHandshake },
  { label: "Nonprofits", icon: ShieldCheck },
  { label: "Project Teams", icon: Briefcase },
] as const;

const principles = [
  ["Clarity", "Financial information should be understandable."],
  ["Accountability", "Important financial decisions should be traceable."],
  ["Collaboration", "The team should be able to work from shared records."],
] as const;

const ROLE_VIEWS = [
  {
    id: "owner",
    label: "Owner & Admin",
    summary: "Configure organization settings, approval rules, and member permissions.",
    permissions: [
      "Manage workspace settings, reporting periods, and Projects",
      "Invite teammates and assign officer or member roles",
      "Review audit logs and oversee published financial snapshots",
    ],
  },
  {
    id: "treasurer",
    label: "Treasurer",
    summary: "Run day-to-day collections, budgets, expenses, and cash advances.",
    permissions: [
      "Create collections, record member payments, and reconcile dues",
      "Allocate budgets and verify submitted expense receipts",
      "Release cash advances and review liquidation settlements",
    ],
  },
  {
    id: "member",
    label: "Member",
    summary: "Stay informed with personal obligation tracking and transparent ledgers.",
    permissions: [
      "View personal dues, payment history, and issued receipts",
      "Follow approved organization financial activity in real time",
      "Submit expense claims or ask Bani about workspace activity",
    ],
  },
] as const;

const headingStyle =
  "text-3xl leading-[1.12] tracking-[-0.025em] sm:text-4xl md:text-[42px]";

export default function About() {
  const [activeRoleId, setActiveRoleId] = useState<(typeof ROLE_VIEWS)[number]["id"]>("owner");
  const activeRole = ROLE_VIEWS.find((r) => r.id === activeRoleId) ?? ROLE_VIEWS[0];
  const canonical = new URL("/about", import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin).href;

  return (
    <div className="min-h-screen bg-canvas font-body text-primary">
      <title>About Bantai | Collaborative Financial Accountability</title>
      <meta
        name="description"
        content="Learn how Bantai helps organizations organize collections, budgets, expenses, and financial decisions in one collaborative workspace."
      />
      <link rel="canonical" href={canonical} />
      <meta property="og:url" content={canonical} />
      <meta property="og:title" content="About Bantai | Collaborative Financial Accountability" />
      <meta
        property="og:description"
        content="Learn how Bantai helps organizations organize collections, budgets, expenses, and financial decisions in one collaborative workspace."
      />

      <Navbar />

      <main className="relative overflow-hidden">
        {/* Monochrome Architectural Blueprint Hero */}
        <section className="relative isolate px-6 pt-36 text-center sm:px-10 sm:pt-44">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-30 h-[420px] bg-[radial-gradient(55%_55%_at_50%_0%,rgba(0,0,0,0.045)_0%,rgba(0,0,0,0.015)_45%,transparent_100%)] dark:bg-[radial-gradient(55%_55%_at_50%_0%,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_45%,transparent_100%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(to_right,rgba(0,0,0,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.05)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:96px_96px] bg-[position:50%_0] [mask-image:radial-gradient(ellipse_78%_68%_at_50%_35%,black_20%,transparent_100%)]"
          />
          {/* Animated Monochrome Cross-Grid Pulses */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_72%_65%_at_50%_40%,black_25%,transparent_100%)]"
          >
            <span
              className="animate-grid-beam-x absolute left-[22%] top-[192px] h-px w-32 bg-gradient-to-r from-transparent via-zinc-900/40 dark:via-white/75 to-transparent"
              style={{ animationDelay: "0.4s" }}
            />
            <span
              className="animate-grid-beam-x absolute left-[54%] top-[288px] h-px w-36 bg-gradient-to-r from-transparent via-zinc-900/35 dark:via-white/65 to-transparent"
              style={{ animationDelay: "2.1s" }}
            />
            <span
              className="animate-grid-beam-y absolute left-[calc(50%-192px)] top-12 h-32 w-px bg-gradient-to-b from-transparent via-zinc-900/40 dark:via-white/70 to-transparent"
              style={{ animationDelay: "1.1s" }}
            />
            <span
              className="animate-grid-beam-y absolute left-[calc(50%+192px)] top-20 h-36 w-px bg-gradient-to-b from-transparent via-zinc-900/40 dark:via-white/75 to-transparent"
              style={{ animationDelay: "2.7s" }}
            />
          </div>

          <div className="mx-auto max-w-4xl">
            <ScrollReveal delay={0}>
              <h1 className="mx-auto max-w-4xl text-balance font-heading text-4xl leading-[1.04] tracking-[-0.03em] sm:text-6xl md:text-[62px]">
                <span className="text-display-gradient">
                  A clearer way to manage money together.
                </span>
              </h1>
            </ScrollReveal>
            <ScrollReveal delay={70}>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-secondary md:text-lg">
                Bantai brings collections, budgets, expenses, and financial
                decisions into a collaborative workspace designed around clarity,
                responsibility, and accountability.
              </p>
            </ScrollReveal>
          </div>

          {/* Interactive Role & Accountability Blueprint Strip (Masked Bottom Fade) */}
          <ScrollReveal delay={140} className="mx-auto mt-14 max-w-4xl text-left">
            <div className="relative overflow-hidden rounded-t-2xl border border-b-0 border-subtle dark:border-white/15 bg-surface dark:bg-[#09090B] [mask-image:linear-gradient(to_bottom,black_58%,transparent_100%)]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-black/15 dark:via-white/50 to-transparent"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle dark:border-white/[0.08] bg-elevated dark:bg-[#0C0C10] px-4 py-3 sm:px-6">
                <span className="font-mono text-[11px] uppercase tracking-wider text-secondary">
                  Shared Ledger · Role Perspectives
                </span>
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Organization roles">
                  {ROLE_VIEWS.map((role) => {
                    const active = role.id === activeRole.id;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActiveRoleId(role.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-2 ${
                          active
                            ? "border-action bg-action text-action-fg"
                            : "border-subtle bg-surface text-secondary hover:text-primary dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400 dark:hover:text-white"
                        }`}
                      >
                        {role.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div role="tabpanel" className="grid gap-6 p-6 sm:grid-cols-[1fr_1.3fr] sm:p-8 pb-16">
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
                    Active View
                  </span>
                  <h2 className="mt-2 font-heading text-2xl font-medium text-primary">
                    {activeRole.label}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    {activeRole.summary}
                  </p>
                </div>
                <ul className="space-y-3 border-t border-subtle pt-4 sm:border-t-0 sm:border-l sm:pl-6 sm:pt-0">
                  {activeRole.permissions.map((perm) => (
                    <li key={perm} className="flex items-start gap-2.5 text-sm text-primary/90">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>{perm}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </ScrollReveal>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-b from-transparent to-canvas"
          />
        </section>

        <div className="mx-auto max-w-6xl px-6 pb-24 sm:px-10">
          <section
            aria-labelledby="about-capabilities"
            className="py-16 sm:py-24"
          >
            <ScrollReveal className="mb-10 text-center">
              <h2 id="about-capabilities" className={headingStyle}>
                <span className="text-display-gradient">What Bantai does</span>
              </h2>
            </ScrollReveal>
            <HairlineGrid items={capabilities} />
          </section>

          <RimDivider />

          <section
            id="governance"
            className="grid gap-8 py-16 sm:grid-cols-[1fr_1.4fr] sm:items-center sm:py-24"
          >
            <ScrollReveal delay={0}>
              <h2 className={headingStyle}>
                <span className="text-display-gradient">Who it’s for</span>
              </h2>
              <p className="mt-4 max-w-xl leading-relaxed text-secondary">
                Bantai is designed for groups that manage shared funds, including
                student organizations, clubs, associations, community groups,
                nonprofits, and teams.
              </p>
            </ScrollReveal>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {audiences.map(({ label, icon: Icon }, idx) => (
                <ScrollReveal
                  key={label}
                  delay={idx * 45}
                  distance={8}
                  className="flex items-center gap-3 rounded-xl border border-subtle bg-surface px-4 py-3.5 text-sm font-medium text-primary shadow-xs dark:shadow-none"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-subtle bg-elevated text-secondary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span>{label}</span>
                </ScrollReveal>
              ))}
            </div>
          </section>

          <RimDivider />

          <section aria-labelledby="about-principles" className="py-16 sm:py-24">
            <ScrollReveal className="mb-10 text-center">
              <h2 id="about-principles" className={headingStyle}>
                <span className="text-display-gradient">Our principles</span>
              </h2>
            </ScrollReveal>
            <HairlineGrid items={principles} />
          </section>

          <ScrollReveal
            as="section"
            className="card-specular mt-6 p-8 sm:p-12"
          >
            <h2 className={headingStyle}>
              <span className="text-display-gradient">
                Every platform begins with a problem worth solving.
              </span>
            </h2>
            <p className="mb-6 mt-3 max-w-xl text-secondary">
              Why is managing shared money often more complicated than it needs to
              be?
            </p>
            <div className="flex flex-wrap items-center gap-6">
              <EditorialLink to="/story">Read Our Story</EditorialLink>
              <EditorialLink to="/#features">Explore Features</EditorialLink>
            </div>
          </ScrollReveal>
        </div>
      </main>

      <Footer />
    </div>
  );
}
