import { ArrowRight, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import ScrollReveal from '../ui/ScrollReveal';
import useAuth from '../../hooks/useAuth';

const FREE_HIGHLIGHTS = [
  'Up to 2 workspaces & 3 active Projects',
  'Unlimited members, dues, budgets & approvals',
  'Workspace customization (logo, cover & theme)',
  'Starter Bani AI & receipt scan quota + CSV exports',
];

const PRO_HIGHLIGHTS = [
  'Unlimited workspaces & Projects (Spaces)',
  'Full Bani AI Assistant & Receipt Q&A quota',
  'High-volume AI receipt scanning & item extraction',
  'Excel (.xlsx) & print-ready PDF financial reports',
];

export default function HomePlans() {
  const { user } = useAuth();

  return (
    <section
      id="plans"
      aria-labelledby="plans-heading"
      className="w-full py-24 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto relative hardware-sharp"
    >
      <div className="pointer-events-none hidden dark:block absolute top-14 left-1/2 -translate-x-1/2 w-[min(520px,100%)] h-[220px] bg-zinc-800/20 blur-[120px] animate-ambient-glow" />

      <div className="relative z-10">
        <ScrollReveal direction="up" distance={10} className="text-center max-w-2xl mx-auto">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Pricing
          </p>
          <h2
            id="plans-heading"
            className="mt-3 text-3xl sm:text-4xl md:text-[42px] leading-[1.12] tracking-[-0.025em]"
          >
            <span className="text-display-gradient">Plans for your organization</span>
          </h2>
          <p className="mt-4 font-body font-normal text-sm sm:text-base leading-relaxed text-secondary">
            Compare Free Community and Pro to find the right fit for your workspaces.
          </p>
        </ScrollReveal>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {/* Free Community */}
          <ScrollReveal delay={60} direction="up" distance={10} className="flex">
            <div className="flex flex-col justify-between w-full rounded-2xl border border-subtle bg-surface dark:bg-gradient-to-b dark:from-zinc-900/60 dark:to-zinc-950/95 p-6 sm:p-8 backdrop-blur-xl shadow-sm dark:shadow-none transition-colors duration-200 hover:border-strong">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-heading text-lg font-medium text-primary">
                    Free Community
                  </h3>
                </div>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-heading text-3xl sm:text-4xl font-medium tracking-tight text-primary">
                    PHP 0
                  </span>
                  <span className="text-xs text-muted font-mono">/ month</span>
                </div>
                <p className="mt-3 text-sm text-secondary leading-relaxed">
                  For student councils, clubs, and community groups tracking shared finances.
                </p>

                <ul className="mt-6 space-y-3 border-t border-subtle pt-6">
                  {FREE_HIGHLIGHTS.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-secondary">
                      <Check className="h-4 w-4 shrink-0 mt-0.5 text-muted" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8">
                <Link
                  to={user ? '/dashboard' : '/register'}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-subtle bg-elevated px-5 py-2.5 text-sm font-medium text-primary transition-colors hover:border-strong hover:bg-surface focus-visible:outline-2"
                >
                  {user ? 'Open dashboard' : 'Get started free'}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </ScrollReveal>

          {/* Pro */}
          <ScrollReveal delay={120} direction="up" distance={10} className="flex">
            <div className="relative flex flex-col justify-between w-full rounded-2xl border border-strong bg-surface dark:bg-gradient-to-b dark:from-zinc-900/95 dark:via-zinc-900/75 dark:to-zinc-950 p-6 sm:p-8 backdrop-blur-xl shadow-xl transition-colors duration-200">
              {/* Subtle top rim highlight */}
              <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-black/15 dark:via-white/30 to-transparent" />

              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-heading text-lg font-medium text-primary">
                    Pro
                  </h3>
                  <span className="rounded-full border border-subtle bg-elevated px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                    Full Suite
                  </span>
                </div>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-heading text-3xl sm:text-4xl font-medium tracking-tight text-primary">
                    PHP 250
                  </span>
                  <span className="text-xs text-secondary font-mono">/ month per org</span>
                </div>
                <p className="mt-3 text-sm text-secondary leading-relaxed">
                  For organizations needing unlimited projects, full Bani AI quotas, and Excel/PDF reporting.
                </p>

                <ul className="mt-6 space-y-3 border-t border-subtle pt-6">
                  {PRO_HIGHLIGHTS.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-primary/90">
                      <Check className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8">
                <Link
                  to="/subscriptions"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-action px-5 py-2.5 text-sm font-medium text-action-fg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Explore Pro plan
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </div>

        <ScrollReveal delay={160} direction="up" distance={8} className="mt-8 text-center">
          <Link
            to="/subscriptions"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary transition-colors"
          >
            Compare all plan features
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </ScrollReveal>
      </div>
    </section>
  );
}
