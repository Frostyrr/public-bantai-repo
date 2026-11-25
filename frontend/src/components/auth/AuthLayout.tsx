import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import baniIcon from "../../assets/Bani 4.png";
import AuthCard from "./AuthCard";
import { BantaiLogo } from "../ui/BantaiLogo";

export default function AuthLayout({ children, returnTo = "/", view }: { children: ReactNode; returnTo?: "/" | "/login"; view?: "login" | "register" }) {
  if (view) {
    const isRegister = view === "register";
    const brand = <Link to="/" aria-label="Bantai home" className="inline-flex items-center gap-2.5 font-heading text-xl font-medium tracking-tight text-primary"><BantaiLogo className="size-8 object-contain" alt="" />Bantai</Link>;
    const back = <Link to="/" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-subtle bg-surface px-3 text-xs text-secondary transition-colors hover:border-strong hover:text-primary"><ArrowLeft className="size-3.5" aria-hidden="true" />Back to home</Link>;
    return (
      <main className="auth-layout auth-split grid min-h-screen bg-canvas font-body text-primary dark:bg-[#050507] dark:text-white lg:grid-cols-2">
        <aside className="sticky top-0 hidden h-screen flex-col justify-between overflow-hidden border-r border-subtle bg-canvas p-8 dark:border-white/[0.08] dark:bg-[#050507] lg:flex xl:p-10">
          {/* Top Monochrome Ambient Spotlight */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-30 hidden h-96 bg-[radial-gradient(65%_60%_at_50%_0%,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_50%,transparent_100%)] dark:block" />
          {/* Monochrome Vertical Architectural Lines (96px spacing) */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(to_right,rgba(0,0,0,0.035)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:96px_100%] bg-[position:50%_0] [mask-image:radial-gradient(ellipse_80%_75%_at_50%_42%,black_25%,transparent_100%)]" />
          {/* Animated Monochrome Vertical Light Beams */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden [mask-image:radial-gradient(ellipse_75%_65%_at_50%_45%,black_25%,transparent_100%)] dark:block">
            <span className="animate-grid-beam-y absolute left-[calc(50%-192px)] top-16 h-28 w-px bg-gradient-to-b from-transparent via-white/65 to-transparent" style={{ animationDelay: "0.3s" }} />
            <span className="animate-grid-beam-y absolute left-1/2 top-8 h-36 w-px bg-gradient-to-b from-transparent via-white/80 to-transparent" style={{ animationDelay: "1.5s" }} />
            <span className="animate-grid-beam-y absolute left-[calc(50%+192px)] top-20 h-28 w-px bg-gradient-to-b from-transparent via-white/60 to-transparent" style={{ animationDelay: "2.4s" }} />
          </div>

          <header className="relative z-10 flex items-center justify-between gap-4">{brand}{back}</header>

          <section className="auth-showcase relative z-10 mx-auto w-full max-w-[540px] py-6">
            <p className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted">
              {isRegister ? "Start with clarity" : "Welcome back"}
            </p>
            <h2 className="max-w-[500px] font-heading text-[clamp(2rem,3vw,3.1rem)] font-medium leading-[1.06] tracking-[-0.03em]">
              <span className="text-display-gradient">
                {isRegister ? "Build financial accountability together." : "Your organization’s ledger, in one place."}
              </span>
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-secondary">
              {isRegister
                ? "Set up your workspace for collections, budgets, expenses, and Projects in minutes."
                : "Sign in to review balances, approve expenses, and stay aligned with your team."}
            </p>

            {/* Monochrome Workspace Preview with Top Glow + Bottom Mask Fade */}
            <div className="relative mt-9">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-12 left-1/2 -z-10 hidden h-20 w-[85%] -translate-x-1/2 dark:block"
                style={{ background: "radial-gradient(50% 100% at 50% 100%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.05) 55%, transparent 100%)" }}
              />
              <div className="card-specular relative overflow-hidden rounded-t-2xl rounded-b-none border border-b-0 border-subtle bg-surface before:inset-x-10 before:via-black/10 dark:border-white/15 dark:bg-[#09090B] dark:before:via-white/55 [mask-image:linear-gradient(to_bottom,black_68%,transparent_100%)]">
                <div className="flex items-center justify-between gap-2 border-b border-subtle bg-elevated px-4 py-3 text-[11px] text-muted dark:border-white/[0.08] dark:bg-[#0C0C10] xl:px-5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="font-medium text-primary">Bantai</span>
                    <ChevronRight className="size-3 text-muted" aria-hidden="true" />
                    <span className="truncate text-secondary">Metro Chapter</span>
                  </div>
                  <span className="rounded-full border border-subtle bg-surface px-2.5 py-0.5 text-[10px] font-medium text-primary dark:border-white/15 dark:bg-white/[0.06]">
                    Owner
                  </span>
                </div>

                <div className="space-y-4 p-4 pb-10 xl:p-5 xl:pb-12">
                  <div className="rounded-xl border border-subtle bg-elevated p-4 dark:border-white/10 dark:bg-[#0D0D11]">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-medium text-primary">
                        <span className="grid size-5 place-items-center rounded-md border border-subtle bg-surface p-0.5 dark:border-white/15 dark:bg-zinc-900">
                          <img src={baniIcon} alt="" className="size-full object-contain grayscale invert dark:invert-0" />
                        </span>
                        Bani Insights
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-subtle bg-surface px-2 py-0.5 text-[10px] text-secondary dark:border-white/15 dark:bg-white/[0.06] dark:text-zinc-200">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        Verified
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-secondary">
                      Reserves stand at <span className="font-medium text-primary">₱184,200</span> with{" "}
                      <span className="font-medium text-primary">64.6%</span> of the General Assembly budget utilized.
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      Recent financial activity
                    </p>
                    <div className="divide-y divide-zinc-200 dark:divide-white/[0.06] text-xs">
                      <div className="flex items-center justify-between gap-3 py-2">
                        <span className="truncate text-secondary">General Assembly Venue &amp; Sound</span>
                        <span className="shrink-0 font-mono tabular-nums text-primary">−₱12,400.00</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 py-2">
                        <span className="truncate text-muted">Semestral Membership Fee · 18 payments</span>
                        <span className="shrink-0 font-mono tabular-nums text-secondary">+₱9,000.00</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <footer className="relative z-10 flex items-center justify-between gap-3 text-[11px] text-muted">
            <span>© 2026 Bantai</span>
            <span className="inline-flex items-center gap-1.5 text-secondary">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
              Role-scoped access · MFA &amp; audit logging
            </span>
          </footer>
        </aside>
        <section className="flex min-w-0 flex-col items-center justify-center px-6 py-8 sm:px-10 lg:py-12">
          <header className="mb-10 flex w-full max-w-[480px] items-center justify-between gap-4 lg:hidden">{brand}{back}</header>
          <div key={view} className={`auth-form-content w-full ${view === "register" ? "max-w-[480px]" : "max-w-[400px]"}`}>
            {children}
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="auth-layout relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-8 font-body text-primary dark:bg-[#050507] dark:text-white">
      {/* Top Monochrome Ambient Spotlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-30 hidden h-[420px] bg-[radial-gradient(55%_55%_at_50%_0%,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_48%,transparent_100%)] dark:block"
      />
      {/* Calm Monochrome Vertical Architectural Lines (128px spacing) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(to_right,rgba(0,0,0,0.03)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:128px_100%] bg-[position:50%_0] [mask-image:radial-gradient(ellipse_65%_65%_at_50%_45%,black_20%,transparent_100%)]"
      />
      {/* Subtle Concentric Rings Framing the Centered Card */}
      <svg
        aria-hidden="true"
        viewBox="0 0 800 800"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 hidden h-[760px] w-[min(760px,96vw)] -translate-x-1/2 -translate-y-1/2 opacity-45 [mask-image:radial-gradient(circle_at_center,black_25%,transparent_75%)] dark:block"
        fill="none"
      >
        <circle cx="400" cy="400" r="180" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        <circle cx="400" cy="400" r="270" stroke="rgba(255,255,255,0.045)" strokeWidth="1" strokeDasharray="4 6" />
        <circle cx="400" cy="400" r="360" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
      </svg>

      <div className="relative z-10 w-full max-w-[420px]">
        <header className="mb-6 flex flex-col items-center gap-3">
          <Link to="/" className="inline-flex h-7 items-center gap-2 font-heading text-xl font-medium text-primary">
            <BantaiLogo className="size-7 object-contain" alt="" />
            Bantai
          </Link>
          <Link to={returnTo} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-subtle bg-surface px-3 text-xs text-secondary transition-colors hover:border-strong hover:text-primary focus-visible:outline-2">
            <ChevronLeft className="size-3.5" aria-hidden="true" />
            {returnTo === "/" ? "Back to home" : "Back to sign in"}
          </Link>
        </header>
        <AuthCard>{children}</AuthCard>
      </div>
    </main>
  );
}
