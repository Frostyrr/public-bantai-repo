import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ListChecks,
  X,
} from "lucide-react";
import useOrgOnboarding from "../../hooks/useOrgOnboarding";

export default function OrgSetupChecklist({ orgId }: { orgId: string }) {
  const { data: onboarding, isPending, setChecklistDismissed } = useOrgOnboarding(orgId);
  const [isExpanded, setIsExpanded] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const prevCompleteRef = useRef<boolean | null>(null);

  const checklist = onboarding?.checklist;
  const allEssentialComplete = Boolean(checklist?.allEssentialComplete);

  useEffect(() => {
    if (prevCompleteRef.current === null) {
      prevCompleteRef.current = allEssentialComplete;
      return;
    }
    if (!prevCompleteRef.current && allEssentialComplete) {
      prevCompleteRef.current = true;
      setJustCompleted(true);
      const timer = window.setTimeout(() => {
        setJustCompleted(false);
        setIsExpanded(false);
      }, 4000);
      return () => window.clearTimeout(timer);
    }
    prevCompleteRef.current = allEssentialComplete;
  }, [allEssentialComplete]);

  if (isPending || !checklist || !checklist.eligible || checklist.dismissed) {
    return null;
  }

  // If essentials were already completed on a previous visit and we're not in the brief completion state,
  // keep it collapsed unless the user manually expands it.
  const essentialTasks = checklist.tasks.filter((t) => !t.optional);
  const optionalTasks = checklist.tasks.filter((t) => t.optional);
  const pct =
    checklist.essentialTotal > 0
      ? Math.round((checklist.essentialCompleted / checklist.essentialTotal) * 100)
      : 0;

  return (
    <div
      data-tour="org-setup-checklist"
      aria-label="Organization setup checklist"
      className="mb-3.5 rounded-xl border border-subtle bg-secondary-surface/85 dark:bg-white/[0.035] p-3 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-strong rounded-md"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-subtle bg-surface text-primary">
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-primary">
              {allEssentialComplete
                ? "Organization setup complete"
                : `Finish organization setup · ${checklist.essentialCompleted}/${checklist.essentialTotal}`}
            </p>
            <div
              aria-hidden="true"
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-skeleton/70"
            >
              <div
                className="h-full rounded-full bg-action transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <span className="shrink-0 text-secondary">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={() => void setChecklistDismissed(true)}
          aria-label="Dismiss setup checklist"
          title="Dismiss checklist (reopen anytime in Help)"
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-hover-surface hover:text-primary focus-visible:outline-2 focus-visible:outline-strong"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {justCompleted && (
        <div
          role="status"
          className="mt-2.5 flex items-center gap-2 rounded-lg border border-sem-success-border bg-sem-success-bg px-2.5 py-2 text-[11px] font-medium text-sem-success-fg"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Essential setup complete. You can reopen this anytime from Help.</span>
        </div>
      )}

      {isExpanded && (
        <div className="mt-3 space-y-2.5 border-t border-subtle pt-2.5">
          <ul className="space-y-2">
            {essentialTasks.map((task) => (
              <li key={task.id} className="flex items-start gap-2">
                {task.completed ? (
                  <CheckCircle2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sem-success-fg"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-medium ${
                        task.completed
                          ? "text-muted line-through"
                          : "text-primary"
                      }`}
                    >
                      {task.title}
                    </span>
                    {!task.completed && (
                      <Link
                        to={task.actionHref}
                        className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-strong rounded-sm"
                      >
                        <span>{task.actionLabel}</span>
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                  {!task.completed && (
                    <p className="mt-0.5 text-[11px] leading-snug text-secondary">
                      {task.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {optionalTasks.length > 0 && (
            <div className="border-t border-subtle/70 pt-2">
              <p className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-muted">
                Optional
              </p>
              <ul className="space-y-2">
                {optionalTasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-2">
                    {task.completed ? (
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sem-success-fg"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`font-medium ${
                            task.completed
                              ? "text-muted line-through"
                              : "text-primary"
                          }`}
                        >
                          {task.title}
                        </span>
                        {!task.completed && (
                          <Link
                            to={task.actionHref}
                            className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-strong rounded-sm"
                          >
                            <span>{task.actionLabel}</span>
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                      {!task.completed && (
                        <p className="mt-0.5 text-[11px] leading-snug text-secondary">
                          {task.description}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end border-t border-subtle/70 pt-2">
            <button
              type="button"
              onClick={() => void setChecklistDismissed(true)}
              className="cursor-pointer text-[11px] text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-strong rounded-sm"
            >
              Dismiss checklist
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
