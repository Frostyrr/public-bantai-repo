import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useAuth from "./useAuth";
import {
  getOrgOnboarding,
  updateOrgOnboarding,
  type OnboardingTourId,
  type OnboardingTourStatus,
  type OrgOnboardingState,
} from "../lib/api";

// Session-scoped fallback so a failed PATCH never causes a recurring prompt loop.
const sessionHandledTours = new Set<string>();

export function tourSessionKey(userId: string, orgId: string, tourId: OnboardingTourId) {
  return `${userId}:${orgId}:${tourId}`;
}

export function isTourHandledInSession(
  userId: string | undefined,
  orgId: string | undefined,
  tourId: OnboardingTourId,
) {
  if (!userId || !orgId) return false;
  return sessionHandledTours.has(tourSessionKey(userId, orgId, tourId));
}

export function markTourHandledInSession(
  userId: string | undefined,
  orgId: string | undefined,
  tourId: OnboardingTourId,
) {
  if (!userId || !orgId) return;
  sessionHandledTours.add(tourSessionKey(userId, orgId, tourId));
}

export function clearTourHandledInSession(
  userId: string | undefined,
  orgId: string | undefined,
  tourId: OnboardingTourId,
) {
  if (!userId || !orgId) return;
  sessionHandledTours.delete(tourSessionKey(userId, orgId, tourId));
}

export function clearAllSessionTourGuards() {
  sessionHandledTours.clear();
}

export function orgOnboardingQueryKey(userId: string | undefined, orgId: string | undefined) {
  return ["org-onboarding", userId ?? "anon", orgId ?? "none"] as const;
}

export default function useOrgOnboarding(orgId: string | undefined, enabled = true) {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const queryKey = orgOnboardingQueryKey(userId, orgId);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getOrgOnboarding(orgId!, signal),
    enabled: Boolean(userId && orgId && enabled),
    staleTime: 60_000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateOrgOnboarding>[1]) => {
      if (!orgId) {
        return Promise.reject(new Error("Organization ID is required."));
      }
      return updateOrgOnboarding(orgId, payload);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<OrgOnboardingState>(queryKey, updated);
    },
  });

  const updateTour = useCallback(
    async (params: {
      tourId: OnboardingTourId;
      version: number;
      status: OnboardingTourStatus;
      step?: number;
    }) => {
      if (!orgId || !userId) return;
      if (params.status === "completed" || params.status === "dismissed") {
        markTourHandledInSession(userId, orgId, params.tourId);
      } else if (params.status === "not_started") {
        clearTourHandledInSession(userId, orgId, params.tourId);
      }

      // Optimistically update cache so UI responds immediately even if network is slow.
      queryClient.setQueryData<OrgOnboardingState>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          tours: {
            ...current.tours,
            [params.tourId]: {
              version: params.version,
              status: params.status,
              step: params.step ?? 0,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });

      try {
        await mutation.mutateAsync({ tourUpdate: params });
      } catch {
        // Persistence failure must never block normal application use.
      }
    },
    [mutation, orgId, queryClient, queryKey, userId],
  );

  const setChecklistDismissed = useCallback(
    async (dismissed: boolean) => {
      if (!orgId || !userId) return;
      queryClient.setQueryData<OrgOnboardingState>(queryKey, (current) =>
        current
          ? {
              ...current,
              checklist: { ...current.checklist, dismissed },
            }
          : current,
      );
      try {
        await mutation.mutateAsync({ checklistDismissed: dismissed });
      } catch {
        // Non-blocking fallback.
      }
    },
    [mutation, orgId, queryClient, queryKey, userId],
  );

  const markOrgDetailsReviewed = useCallback(async () => {
    if (!orgId || !userId) return;
    try {
      await mutation.mutateAsync({ markOrgDetailsReviewed: true });
    } catch {
      // Non-blocking fallback.
    }
  }, [mutation, orgId, userId]);

  return {
    ...query,
    isUpdating: mutation.isPending,
    updateTour,
    setChecklistDismissed,
    markOrgDetailsReviewed,
  };
}
