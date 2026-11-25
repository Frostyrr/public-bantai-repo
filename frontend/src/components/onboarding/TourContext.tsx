import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import useOrgOnboarding, {
  isTourHandledInSession,
  markTourHandledInSession,
} from "../../hooks/useOrgOnboarding";
import type { OnboardingTourId } from "../../lib/api";
import CoachmarkSpotlight, { type SpotlightStepView } from "./CoachmarkSpotlight";
import {
  isPersistedTourId,
  resolveTourSteps,
  TOUR_DEFINITIONS,
  type GuideId,
  type TourStepDefinition,
} from "./tours";

interface TourContextValue {
  activeTourId: GuideId | null;
  startTour: (tourId: GuideId, options?: { manual?: boolean }) => void;
  stopTour: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

function findVisibleTarget(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return el;
    }
  }
  return null;
}

function isInteractionSuppressed(onboardingStep: string | null | undefined): boolean {
  if (onboardingStep) return true;
  if (typeof document === "undefined") return true;

  // Suppress if any non-coachmark modal/dialog is open
  const openDialogs = document.querySelectorAll(
    '[role="dialog"][aria-modal="true"]:not([data-coachmark-dialog="true"])',
  );
  if (openDialogs.length > 0) return true;

  // Suppress if user is actively typing or editing a form field
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const tag = active.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable) {
      return true;
    }
  }

  return false;
}

interface ActiveRun {
  tourId: GuideId;
  steps: Array<{ def: TourStepDefinition; view: SpotlightStepView }>;
  index: number;
}

export function TourProvider({
  orgId,
  role,
  workspaceReady,
  children,
}: {
  orgId: string | undefined;
  role: string | undefined;
  workspaceReady: boolean;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: onboarding, isSuccess, updateTour } = useOrgOnboarding(orgId, Boolean(orgId && role && workspaceReady));

  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);

  const activeTourIdRef = useRef<GuideId | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const autoAttemptedRef = useRef<Set<string>>(new Set());

  const clearPendingTimer = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  const stopTour = useCallback(() => {
    clearPendingTimer();
    activeTourIdRef.current = null;
    setActiveRun(null);
    setTargetElement(null);
  }, [clearPendingTimer]);

  useEffect(() => () => clearPendingTimer(), [clearPendingTimer]);

  const launchResolvedTour = useCallback(
    (tourId: GuideId, currentRole: string, manual: boolean) => {
      if (activeTourIdRef.current === tourId) return;
      if (!manual && isInteractionSuppressed(user?.onboardingStep)) return;

      const candidates = resolveTourSteps(tourId, currentRole);
      const resolved: Array<{ def: TourStepDefinition; view: SpotlightStepView; el: HTMLElement }> = [];

      for (const stepDef of candidates) {
        const el = findVisibleTarget(stepDef.targets);
        if (!el) continue;
        resolved.push({
          def: stepDef,
          el,
          view: {
            id: stepDef.id,
            title: stepDef.title,
            body: typeof stepDef.body === "function" ? stepDef.body(currentRole) : stepDef.body,
            preferredPlacement: stepDef.preferredPlacement,
          },
        });
      }

      if (resolved.length === 0) {
        return;
      }

      activeTourIdRef.current = tourId;
      setActiveRun({
        tourId,
        steps: resolved.map((r) => ({ def: r.def, view: r.view })),
        index: 0,
      });
      setTargetElement(resolved[0].el);

      if (orgId && isPersistedTourId(tourId)) {
        void updateTour({
          tourId,
          version: TOUR_DEFINITIONS[tourId].version,
          status: "in_progress",
          step: 0,
        });
      }
    },
    [orgId, updateTour, user?.onboardingStep],
  );

  const startTour = useCallback(
    (tourId: GuideId, options?: { manual?: boolean }) => {
      if (!orgId || !role) return;
      const manual = Boolean(options?.manual);

      // Guard against duplicate starts
      if (activeTourIdRef.current === tourId) return;

      clearPendingTimer();
      const targetSuffix = TOUR_DEFINITIONS[tourId].routeSuffix;
      const expectedPath = `/app/org/${orgId}/${targetSuffix}`;

      if (!location.pathname.endsWith(`/${targetSuffix}`)) {
        if (!manual) return;
        navigate(expectedPath);
        // Wait for lazy route + targets to mount before resolving spotlight
        pendingTimerRef.current = window.setTimeout(() => {
          pendingTimerRef.current = null;
          launchResolvedTour(tourId, role, true);
        }, 320);
        return;
      }

      launchResolvedTour(tourId, role, manual);
    },
    [clearPendingTimer, launchResolvedTour, location.pathname, navigate, orgId, role],
  );

  // Auto-offer contextual tour on first relevant visit (Overview or Projects)
  useEffect(() => {
    if (!workspaceReady || !orgId || !role || !isSuccess || !onboarding) return;
    if (activeTourIdRef.current) return;
    if (isInteractionSuppressed(user?.onboardingStep)) return;

    let candidateTour: OnboardingTourId | null = null;
    if (location.pathname.endsWith("/overview")) {
      candidateTour = "org_overview";
    } else if (location.pathname.endsWith("/spaces")) {
      candidateTour = "org_projects";
    }

    if (!candidateTour) return;

    const progress = onboarding.tours[candidateTour];
    if (!progress || progress.status !== "not_started") return;
    if (isTourHandledInSession(user?.id, orgId, candidateTour)) return;

    const attemptKey = `${user?.id ?? "anon"}:${orgId}:${candidateTour}`;
    if (autoAttemptedRef.current.has(attemptKey)) return;

    clearPendingTimer();
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null;
      if (activeTourIdRef.current || isInteractionSuppressed(user?.onboardingStep)) return;
      autoAttemptedRef.current.add(attemptKey);
      launchResolvedTour(candidateTour!, role, false);
    }, 450);

    return () => clearPendingTimer();
  }, [
    clearPendingTimer,
    isSuccess,
    launchResolvedTour,
    location.pathname,
    onboarding,
    orgId,
    role,
    user?.id,
    user?.onboardingStep,
    workspaceReady,
  ]);

  const handleBack = useCallback(() => {
    setActiveRun((current) => {
      if (!current || current.index <= 0) return current;
      const nextIndex = current.index - 1;
      const el = findVisibleTarget(current.steps[nextIndex].def.targets);
      setTargetElement(el);
      return { ...current, index: nextIndex };
    });
  }, []);

  const handleNext = useCallback(() => {
    setActiveRun((current) => {
      if (!current) return current;
      // Find next step with a currently visible target
      for (let idx = current.index + 1; idx < current.steps.length; idx++) {
        const el = findVisibleTarget(current.steps[idx].def.targets);
        if (el) {
          setTargetElement(el);
          if (orgId && isPersistedTourId(current.tourId)) {
            void updateTour({
              tourId: current.tourId,
              version: TOUR_DEFINITIONS[current.tourId].version,
              status: "in_progress",
              step: idx,
            });
          }
          return { ...current, index: idx };
        }
      }
      return current;
    });
  }, [orgId, updateTour]);

  const handleSkip = useCallback(() => {
    const current = activeRun;
    stopTour();
    if (current && orgId && isPersistedTourId(current.tourId)) {
      markTourHandledInSession(user?.id, orgId, current.tourId);
      void updateTour({
        tourId: current.tourId,
        version: TOUR_DEFINITIONS[current.tourId].version,
        status: "dismissed",
        step: current.index,
      });
    }
  }, [activeRun, orgId, stopTour, updateTour, user?.id]);

  const handleFinish = useCallback(() => {
    const current = activeRun;
    stopTour();
    if (current && orgId && isPersistedTourId(current.tourId)) {
      markTourHandledInSession(user?.id, orgId, current.tourId);
      void updateTour({
        tourId: current.tourId,
        version: TOUR_DEFINITIONS[current.tourId].version,
        status: "completed",
        step: current.steps.length - 1,
      });
    }
  }, [activeRun, orgId, stopTour, updateTour, user?.id]);

  const contextValue = useMemo<TourContextValue>(
    () => ({
      activeTourId: activeRun?.tourId ?? null,
      startTour,
      stopTour,
    }),
    [activeRun?.tourId, startTour, stopTour],
  );

  const currentStep = activeRun ? activeRun.steps[activeRun.index]?.view ?? null : null;

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      <CoachmarkSpotlight
        isOpen={Boolean(activeRun && currentStep)}
        tourTitle={activeRun ? TOUR_DEFINITIONS[activeRun.tourId].title : ""}
        step={currentStep}
        targetElement={targetElement}
        stepIndex={activeRun?.index ?? 0}
        totalSteps={activeRun?.steps.length ?? 0}
        onBack={handleBack}
        onNext={handleNext}
        onSkip={handleSkip}
        onFinish={handleFinish}
      />
    </TourContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrgTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    return {
      activeTourId: null,
      startTour: () => undefined,
      stopTour: () => undefined,
    };
  }
  return ctx;
}
