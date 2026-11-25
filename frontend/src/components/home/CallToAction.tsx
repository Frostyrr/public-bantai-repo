import React from "react";
import useAuth from "../../hooks/useAuth";
import { ArrowRight, Sparkles } from "lucide-react";
import Button from "../ui/Button";
import ScrollReveal from "../ui/ScrollReveal";

export const CallToAction: React.FC = () => {
  const { user } = useAuth();
  return (
    <section className="w-full mt-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto relative hardware-sharp">
      <ScrollReveal direction="up" distance={14}>
        <div className="card-specular relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl border border-subtle bg-surface dark:border-zinc-800/90 dark:bg-[#09090B] p-8 text-center sm:p-16 dark:before:inset-x-16 dark:before:via-white/35">
          {/* Subtle hairline grid & radial top light */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_65%_55%_at_50%_15%,black_25%,transparent_100%)]"
          />

          <ScrollReveal delay={40} distance={10} className="relative z-10">
            <span className="page-eyebrow inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-secondary" aria-hidden="true" />
              <span className="eyebrow-gradient">{user ? "Your workspace is ready" : "Start in minutes"}</span>
            </span>
          </ScrollReveal>

          <ScrollReveal delay={90} distance={10} className="relative z-10">
            <h2 className="max-w-2xl text-3xl sm:text-4xl md:text-[42px] leading-[1.12] tracking-[-0.025em]">
              <span className="text-display-gradient">
                Bring total financial clarity to your organization.
              </span>
            </h2>
          </ScrollReveal>

          <ScrollReveal delay={140} distance={10} className="relative z-10">
            <p className="font-body font-normal text-secondary text-sm sm:text-base max-w-lg leading-relaxed">
              Bring your collections, budgets, and expense records into one
              place. Create an account or return to your workspace.
            </p>
          </ScrollReveal>

          <ScrollReveal delay={190} distance={10} className="relative z-10">
            <div className="flex flex-wrap items-center justify-center gap-3.5 mt-1">
              <Button
                variant="primary"
                to={user ? "/dashboard" : "/register"}
                iconRight={<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />}
                className="group rounded-full px-7 py-3 text-sm font-medium bg-action hover:opacity-90 text-action-fg shadow-md dark:shadow-[0_0_24px_rgba(255,255,255,0.08)] transition-all cursor-pointer"
              >
                {user ? "Open dashboard" : "Create an account"}
              </Button>

              {!user && (
                <Button
                  variant="secondary"
                  to="/login"
                  className="rounded-full px-6 py-3 text-sm font-normal text-primary border border-subtle hover:border-strong bg-elevated backdrop-blur-md transition-colors cursor-pointer"
                >
                  Sign in
                </Button>
              )}
            </div>
          </ScrollReveal>
        </div>
      </ScrollReveal>
    </section>
  );
};

export default CallToAction;
