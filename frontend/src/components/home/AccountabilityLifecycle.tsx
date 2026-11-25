import React, { useState, useEffect, useRef, useMemo } from 'react';
import { UserCheck, Users, ShieldCheck, Check } from 'lucide-react';
import ScrollReveal from '../ui/ScrollReveal';

export const AccountabilityLifecycle: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Array<HTMLDivElement | null>>([]);
  const stepCardRefs = useRef<Array<HTMLDivElement | null>>([]);

  const [activeStep, setActiveStep] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 3 : 0);
  const [trackBounds, setTrackBounds] = useState<{ top: number; height: number }>({
    top: 28,
    height: 480,
  });
  const [nodePositions, setNodePositions] = useState<number[]>([0, 50, 100]);

  // Compute exact pixel positions of node centers for responsive, pixel-perfect alignment
  useEffect(() => {
    const updateBounds = () => {
      const container = containerRef.current;
      const n0 = nodeRefs.current[0];
      const n1 = nodeRefs.current[1];
      const n2 = nodeRefs.current[2];

      if (!container || !n0 || !n1 || !n2) return;

      const cRect = container.getBoundingClientRect();
      const r0 = n0.getBoundingClientRect();
      const r1 = n1.getBoundingClientRect();
      const r2 = n2.getBoundingClientRect();

      const y0 = r0.top - cRect.top + r0.height / 2;
      const y1 = r1.top - cRect.top + r1.height / 2;
      const y2 = r2.top - cRect.top + r2.height / 2;

      const total = y2 - y0;
      if (total > 0) {
        setTrackBounds({ top: y0, height: total });
        setNodePositions([0, ((y1 - y0) / total) * 100, 100]);
      }
    };

    updateBounds();
    window.addEventListener('resize', updateBounds);
    const timer = setTimeout(updateBounds, 300);

    return () => {
      window.removeEventListener('resize', updateBounds);
      clearTimeout(timer);
    };
  }, []);

  // Animate leading line downwards as each step appears/scrolls into view
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      return;
    }

    const cards = stepCardRefs.current.filter(Boolean) as HTMLDivElement[];
    if (cards.length === 0) return;

    const visible = [false, false, false];
    let cascadeTimer1: ReturnType<typeof setTimeout> | null = null;
    let cascadeTimer2: ReturnType<typeof setTimeout> | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = cards.indexOf(entry.target as HTMLDivElement);
          if (index !== -1 && entry.isIntersecting) {
            visible[index] = true;
          }
        });

        if (visible[2]) {
          // If step 3 is visible, ensure smooth cascade to 3
          setActiveStep((prev) => Math.max(prev, 1));
          cascadeTimer1 = setTimeout(() => {
            setActiveStep((prev) => Math.max(prev, 2));
            cascadeTimer2 = setTimeout(() => {
              setActiveStep(3);
            }, 320);
          }, 320);
        } else if (visible[1]) {
          // Step 2 is reached
          setActiveStep((prev) => Math.max(prev, 1));
          cascadeTimer1 = setTimeout(() => {
            setActiveStep((prev) => Math.max(prev, 2));
          }, 320);
        } else if (visible[0]) {
          // Step 1 is reached
          setActiveStep((prev) => Math.max(prev, 1));
        }
      },
      {
        threshold: 0.2,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    cards.forEach((card) => observer.observe(card));

    return () => {
      observer.disconnect();
      if (cascadeTimer1) clearTimeout(cascadeTimer1);
      if (cascadeTimer2) clearTimeout(cascadeTimer2);
    };
  }, []);

  const lineProgress = useMemo(() => {
    if (activeStep <= 0) return 0;
    if (activeStep === 1) return 2;
    if (activeStep === 2) return nodePositions[1] || 50;
    return 100;
  }, [activeStep, nodePositions]);

  const steps = [
    {
      step: '01',
      title: 'Create Your Personal Account',
      phase: 'Step 01 · Account Setup',
      tagline: 'Instant setup in under 2 minutes',
      icon: <UserCheck className="w-5 h-5" aria-hidden="true" />,
      description:
        'Sign up securely with your email address or Google account. Your personal dashboard serves as your financial home base to track your contributions and organizations.',
      highlights: [
        'One login for all organizations',
        'Email or one-tap Google authentication',
        'Personal dues and payment receipt history',
      ],
    },
    {
      step: '02',
      title: 'Join or Create an Organization Workspace',
      phase: 'Step 02 · Workspace Access',
      tagline: 'Bring officers and members together',
      icon: <Users className="w-5 h-5" aria-hidden="true" />,
      description:
        'Launch a new workspace for your student council, committee, or club — or enter an invite code to join an existing organization with role-based access controls.',
      highlights: [
        'Create up to 5 organizations on the Free plan',
        'Instant invite codes with 1-click regenerate controls',
        'Granular roles: Owner, Admin, Treasurer, Auditor, Member',
      ],
    },
    {
      step: '03',
      title: 'Manage Collections, Budgets & Reviews',
      phase: 'Step 03 · Financial Governance',
      tagline: 'Total transparency from release to settlement',
      icon: <ShieldCheck className="w-5 h-5" aria-hidden="true" />,
      description:
        'Collect dues with receipt verification, set authorized budgets, release cash advances with liquidation tracking, and log two-officer approvals in an immutable audit trail.',
      highlights: [
        'Batch dues assignments with individual balance tracking',
        'Two-officer verification and approval before fund settlement',
        'Full audit trail recording who submitted and who authorized',
      ],
    },
  ];

  return (
    <section
      id="accountability"
      tabIndex={-1}
      className="pt-28 pb-24 md:pt-32 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto relative hardware-sharp"
    >
      {/* Section Header */}
      <ScrollReveal direction="up" distance={16} className="flex flex-col items-center text-center mb-20">
        <h2 className="max-w-2xl text-3xl sm:text-4xl md:text-[42px] leading-[1.12] tracking-[-0.025em]">
          <span className="text-display-gradient">How Bantai powers your team.</span>
        </h2>
        <p className="font-body font-normal text-secondary text-sm sm:text-base max-w-xl mt-4 leading-relaxed">
          From first sign-up to audited year-end reports: follow the structured workflow that keeps everyone on the same page.
        </p>
      </ScrollReveal>

      {/* Vertical Steps with Animated Silver Rail */}
      <div ref={containerRef} className="relative">
        {/* Leading Line Track Container: Anchored from Node 1 center to Node 3 center */}
        <div
          aria-hidden="true"
          style={{
            top: `${trackBounds.top}px`,
            height: `${trackBounds.height}px`,
          }}
          className="absolute left-[22px] sm:left-7 -translate-x-1/2 w-1 pointer-events-none z-0"
        >
          {/* Blueprint Inactive Runway Track */}
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-800/50 rounded-full" />

          {/* Active Illuminated Downward Progress Line */}
          <div
            style={{
              height: `${lineProgress}%`,
              transition: 'height 750ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className="absolute top-0 left-0 right-0 overflow-visible"
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-linear-to-b from-zinc-900/40 via-zinc-500/60 to-zinc-300/20 dark:from-white/40 dark:via-zinc-700/80 dark:to-zinc-900/20" />
          </div>
        </div>

        {/* Steps List */}
        <div className="space-y-12 sm:space-y-16">
          {steps.map((st, idx) => {
            return (
              <div
                key={st.step}
                ref={(el) => {
                  stepCardRefs.current[idx] = el;
                }}
              >
                <ScrollReveal
                  delay={idx * 75}
                  direction="up"
                  distance={16}
                  className="relative flex items-start gap-3 sm:gap-8"
                >
                  <div
                    ref={(el) => {
                      nodeRefs.current[idx] = el;
                    }}
                    aria-hidden="true"
                    className="relative z-10 flex size-11 sm:size-14 shrink-0 flex-col items-center justify-center rounded-xl sm:rounded-2xl border border-subtle bg-surface shadow-[0_6px_18px_-4px_rgba(15,23,42,0.08)] dark:border-zinc-700/90 dark:bg-linear-to-b dark:from-zinc-900 dark:via-zinc-950 dark:to-black dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_10px_25px_-5px_rgba(0,0,0,0.85)]"
                  >
                    <span className="text-sm sm:text-base font-medium tabular-nums text-primary">{st.step}</span>
                    <span className="text-[8px] sm:text-[9px] font-medium uppercase tracking-widest text-muted">Step</span>
                  </div>

                  <div className="card-specular min-w-0 flex-1 p-4 transition-colors hover:border-strong sm:p-8">
                    {/* Card Top Meta */}
                    <div className="mb-4 flex items-start justify-between gap-2">
                      <p className="text-xs font-medium leading-relaxed text-primary">
                        {st.phase}{' '}
                        <span className="text-muted">· {st.tagline}</span>
                      </p>
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-subtle bg-elevated text-primary">
                        {st.icon}
                      </div>
                    </div>

                    <h3 className="mb-3 font-heading text-xl font-medium tracking-tight text-primary sm:text-2xl">
                      {st.title}
                    </h3>
                    <p className="font-body font-normal text-secondary text-sm sm:text-base leading-relaxed mb-6">
                      {st.description}
                    </p>

                    {/* Highlights List */}
                    <div className="pt-4 border-t border-subtle grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {st.highlights.map((hl, hIdx) => (
                        <div
                          key={hIdx}
                          className="flex items-start gap-2 text-xs font-body text-secondary"
                        >
                          <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                          <span className="leading-snug">{hl}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </ScrollReveal>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default AccountabilityLifecycle;
