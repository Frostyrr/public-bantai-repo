import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import Button from "../ui/Button";

export interface SpotlightStepView {
  id: string;
  title: string;
  body: string;
  preferredPlacement?: "top" | "bottom" | "left" | "right";
}

export interface CoachmarkSpotlightProps {
  isOpen: boolean;
  tourTitle: string;
  step: SpotlightStepView | null;
  targetElement: HTMLElement | null;
  stepIndex: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

interface RectBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 8;
const VIEWPORT_MARGIN = 12;
const PANEL_GAP = 14;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("reduce-motion")
  );
}

export default function CoachmarkSpotlight({
  isOpen,
  tourTitle,
  step,
  targetElement,
  stepIndex,
  totalSteps,
  onBack,
  onNext,
  onSkip,
  onFinish,
}: CoachmarkSpotlightProps) {
  const titleId = useId();
  const descId = useId();
  const maskId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [targetRect, setTargetRect] = useState<RectBox | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({
    top: 80,
    left: 16,
  });

  const isFirst = stepIndex === 0;
  const isLast = stepIndex >= totalSteps - 1;

  // Save & restore focus across tour lifecycle
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
        panelRef.current.focus();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (
        previousFocusRef.current &&
        document.contains(previousFocusRef.current)
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  // Keyboard handling (Escape to skip)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onSkip();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onSkip]);

  // Scroll target into view when step changes
  useEffect(() => {
    if (!isOpen || !targetElement) return;
    targetElement.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [isOpen, targetElement, step?.id]);

  // Track target bounding box on scroll, resize, and target mutations
  useLayoutEffect(() => {
    if (!isOpen || !targetElement) return;

    let rafId = 0;
    const measure = () => {
      if (!document.contains(targetElement)) {
        setTargetRect(null);
        return;
      }
      const rect = targetElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setTargetRect(null);
        return;
      }
      const top = Math.max(0, rect.top - SPOTLIGHT_PADDING);
      const left = Math.max(0, rect.left - SPOTLIGHT_PADDING);
      const width = Math.min(
        window.innerWidth - left,
        rect.width + SPOTLIGHT_PADDING * 2,
      );
      const height = Math.min(
        window.innerHeight - top,
        rect.height + SPOTLIGHT_PADDING * 2,
      );
      setTargetRect({ top, left, width, height });
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    window.addEventListener("scroll", scheduleMeasure, { capture: true, passive: true });

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(targetElement);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, { capture: true });
      resizeObserver.disconnect();
    };
  }, [isOpen, targetElement, step?.id]);

  // Compute clamped panel coordinates around targetRect
  useLayoutEffect(() => {
    if (!isOpen || !panelRef.current) return;

    const updatePanelPosition = () => {
      const panelEl = panelRef.current;
      if (!panelEl) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const panelWidth = panelEl.offsetWidth || Math.min(340, vw - VIEWPORT_MARGIN * 2);
      const panelHeight = panelEl.offsetHeight || 200;

      if (!targetRect) {
        setPanelPos({
          top: Math.max(VIEWPORT_MARGIN, Math.round((vh - panelHeight) / 2)),
          left: Math.max(VIEWPORT_MARGIN, Math.round((vw - panelWidth) / 2)),
        });
        return;
      }

      const spaceBottom = vh - (targetRect.top + targetRect.height) - VIEWPORT_MARGIN;
      const spaceTop = targetRect.top - VIEWPORT_MARGIN;
      const spaceRight = vw - (targetRect.left + targetRect.width) - VIEWPORT_MARGIN;
      const spaceLeft = targetRect.left - VIEWPORT_MARGIN;

      const preferred = step?.preferredPlacement ?? "bottom";
      let placement: "top" | "bottom" | "left" | "right" = preferred;

      const fits = (p: typeof placement) => {
        if (p === "bottom") return spaceBottom >= panelHeight + PANEL_GAP;
        if (p === "top") return spaceTop >= panelHeight + PANEL_GAP;
        if (p === "right") return spaceRight >= panelWidth + PANEL_GAP;
        return spaceLeft >= panelWidth + PANEL_GAP;
      };

      if (!fits(placement)) {
        const order: Array<typeof placement> = ["bottom", "top", "right", "left"];
        const fallback = order.find((candidate) => fits(candidate));
        if (fallback) {
          placement = fallback;
        } else {
          // Pick whichever vertical side has more room
          placement = spaceBottom >= spaceTop ? "bottom" : "top";
        }
      }

      let rawTop = 0;
      let rawLeft = 0;

      if (placement === "bottom") {
        rawTop = targetRect.top + targetRect.height + PANEL_GAP;
        rawLeft = targetRect.left;
      } else if (placement === "top") {
        rawTop = targetRect.top - panelHeight - PANEL_GAP;
        rawLeft = targetRect.left;
      } else if (placement === "right") {
        rawTop = targetRect.top;
        rawLeft = targetRect.left + targetRect.width + PANEL_GAP;
      } else {
        rawTop = targetRect.top;
        rawLeft = targetRect.left - panelWidth - PANEL_GAP;
      }

      const clampedLeft = Math.min(
        Math.max(VIEWPORT_MARGIN, rawLeft),
        Math.max(VIEWPORT_MARGIN, vw - panelWidth - VIEWPORT_MARGIN),
      );
      const clampedTop = Math.min(
        Math.max(VIEWPORT_MARGIN, rawTop),
        Math.max(VIEWPORT_MARGIN, vh - panelHeight - VIEWPORT_MARGIN),
      );

      setPanelPos({ top: Math.round(clampedTop), left: Math.round(clampedLeft) });
    };

    const frame = requestAnimationFrame(updatePanelPosition);
    return () => cancelAnimationFrame(frame);
  }, [isOpen, targetRect, step?.id, step?.preferredPlacement]);

  if (!isOpen || !step) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] pointer-events-auto"
      aria-hidden={false}
    >
      {/* Dimmed backdrop with SVG spotlight cutout */}
      <svg
        aria-hidden="true"
        className="fixed inset-0 h-full w-full pointer-events-auto"
        onClick={onSkip}
      >
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx="14"
                ry="14"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(9, 9, 11, 0.64)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {/* Highlight ring around target */}
      {targetRect && (
        <div
          aria-hidden="true"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }}
          className="fixed rounded-[14px] ring-2 ring-white/80 dark:ring-white/90 shadow-[0_0_0_1px_rgba(9,9,11,0.35)] pointer-events-none transition-[top,left,width,height] duration-200 motion-reduce:transition-none"
        />
      )}

      {/* Live region for screen readers */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {`${tourTitle}. Step ${stepIndex + 1} of ${totalSteps}: ${step.title}. ${step.body}`}
      </div>

      {/* Instruction Panel */}
      <div
        ref={panelRef}
        data-coachmark-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button, a[href], [tabindex]',
            ),
          ).filter(
            (el) =>
              el.tabIndex >= 0 &&
              !el.matches(":disabled") &&
              el.getClientRects().length > 0,
          );
          const first = controls[0];
          const last = controls.at(-1);
          const active = document.activeElement;
          if (
            !controls.some((control) => control === active) ||
            (event.shiftKey ? active === first : active === last)
          ) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          }
        }}
        style={{ top: panelPos.top, left: panelPos.left }}
        className="fixed z-[10051] w-[min(340px,calc(100vw-24px))] rounded-2xl border border-strong bg-surface p-4 text-primary shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-strong transition-[top,left] duration-200 motion-reduce:transition-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-secondary">
            <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
            <span>{tourTitle}</span>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Close guide"
            className="grid size-8 -mr-1.5 -mt-1.5 shrink-0 place-items-center rounded-lg text-secondary hover:bg-hover-surface hover:text-primary focus-visible:outline-2 focus-visible:outline-strong cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2
          id={titleId}
          className="mt-2 font-heading text-base font-semibold tracking-tight text-primary"
        >
          {step.title}
        </h2>

        <p
          id={descId}
          className="mt-1.5 text-xs leading-relaxed text-secondary"
        >
          {step.body}
        </p>

        {/* Progress dots + step counter */}
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-subtle pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono tabular-nums text-muted">
              {stepIndex + 1} / {totalSteps}
            </span>
            <div className="flex items-center gap-1" aria-hidden="true">
              {Array.from({ length: totalSteps }).map((_, idx) => (
                <span
                  key={idx}
                  className={`h-1.5 rounded-full transition-all motion-reduce:transition-none ${
                    idx === stepIndex
                      ? "w-4 bg-action"
                      : idx < stepIndex
                        ? "w-1.5 bg-primary/50"
                        : "w-1.5 bg-subtle"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {!isFirst ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onBack}
                className="min-h-9 px-2.5 text-xs"
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
              >
                Back
              </Button>
            ) : (
              <button
                type="button"
                onClick={onSkip}
                className="min-h-9 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-secondary hover:bg-hover-surface hover:text-primary focus-visible:outline-2 focus-visible:outline-strong"
              >
                Skip
              </button>
            )}

            {isLast ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onFinish}
                className="min-h-9 px-3 text-xs"
              >
                Finish
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onNext}
                className="min-h-9 px-3 text-xs"
              >
                <span>Next</span>
                <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
