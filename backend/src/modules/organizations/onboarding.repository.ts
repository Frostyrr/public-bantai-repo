import { createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";

export const TOUR_IDS = ["org_overview", "org_projects"] as const;
export type TourId = (typeof TOUR_IDS)[number];

export const CURRENT_TOUR_VERSIONS: Record<TourId, number> = {
  org_overview: 1,
  org_projects: 1,
};

export type TourStatus = "not_started" | "in_progress" | "completed" | "dismissed";

export interface TourProgress {
  version: number;
  status: TourStatus;
  step: number;
  updatedAt: string | null;
}

export type ChecklistTaskId =
  | "review_org_details"
  | "invite_teammate"
  | "create_collection_or_budget"
  | "create_project";

export interface ChecklistTask {
  id: ChecklistTaskId;
  title: string;
  description: string;
  completed: boolean;
  optional: boolean;
  actionHref: string;
  actionLabel: string;
}

export interface OrgOnboardingState {
  organizationId: string;
  role: string;
  checklist: {
    eligible: boolean;
    dismissed: boolean;
    completedAt: string | null;
    essentialCompleted: number;
    essentialTotal: number;
    allEssentialComplete: boolean;
    tasks: ChecklistTask[];
  };
  tours: Record<TourId, TourProgress>;
}

const VALID_STATUSES = new Set<TourStatus>([
  "not_started",
  "in_progress",
  "completed",
  "dismissed",
]);

function normalizeTours(raw: unknown): Record<TourId, TourProgress> {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const result = {} as Record<TourId, TourProgress>;
  for (const tourId of TOUR_IDS) {
    const currentVersion = CURRENT_TOUR_VERSIONS[tourId];
    const entry =
      source[tourId] && typeof source[tourId] === "object"
        ? (source[tourId] as Record<string, unknown>)
        : null;

    const version =
      entry && typeof entry.version === "number" ? entry.version : 0;
    const rawStatus =
      entry && typeof entry.status === "string"
        ? (entry.status as TourStatus)
        : "not_started";
    const status =
      version >= currentVersion && VALID_STATUSES.has(rawStatus)
        ? rawStatus
        : "not_started";
    const step =
      status === "not_started"
        ? 0
        : entry && typeof entry.step === "number" && entry.step >= 0
          ? Math.floor(entry.step)
          : 0;
    const updatedAt =
      entry && typeof entry.updatedAt === "string" ? entry.updatedAt : null;

    result[tourId] = {
      version: currentVersion,
      status,
      step,
      updatedAt,
    };
  }
  return result;
}

async function requireActiveMembership(
  accessToken: string,
  userId: string,
  organizationId: string,
) {
  const client = createUserClient(accessToken);
  const { data: membership, error } = await client
    .from("organization_members")
    .select("id, role, status")
    .eq("organization_id", organizationId)
    .eq("profile_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new AppError(503, "Unable to verify organization membership.");
  }
  if (!membership) {
    throw new AppError(403, "An active membership is required.");
  }
  return { client, role: membership.role as string };
}

export async function getOrgOnboardingState(
  accessToken: string,
  userId: string,
  organizationId: string,
): Promise<OrgOnboardingState> {
  const { client, role } = await requireActiveMembership(
    accessToken,
    userId,
    organizationId,
  );

  const { data: progressRow, error: progressError } = await client
    .from("organization_onboarding_progress")
    .select(
      "checklist_dismissed, checklist_completed_at, reviewed_org_details_at, tours",
    )
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (progressError) {
    throw new AppError(503, "Unable to load onboarding progress.");
  }

  const tours = normalizeTours(progressRow?.tours);
  const canManageOrg = role === "owner" || role === "organization_admin";
  const canManageFinances = canManageOrg || role === "treasurer";

  if (!canManageFinances) {
    return {
      organizationId,
      role,
      checklist: {
        eligible: false,
        dismissed: Boolean(progressRow?.checklist_dismissed),
        completedAt: progressRow?.checklist_completed_at ?? null,
        essentialCompleted: 0,
        essentialTotal: 0,
        allEssentialComplete: false,
        tasks: [],
      },
      tours,
    };
  }

  const [orgRes, membersRes, collectionsRes, budgetsRes, spacesRes] =
    await Promise.all([
      canManageOrg
        ? client
            .from("organizations")
            .select(
              "id, description, logo_url, cover_image_url, cover_theme, created_at, updated_at",
            )
            .eq("id", organizationId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      canManageOrg
        ? client
            .from("organization_members")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", "active")
        : Promise.resolve({ count: 0, error: null }),
      client
        .from("collections")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      client
        .from("budgets")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      canManageOrg
        ? client
            .from("spaces")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
        : Promise.resolve({ count: 0, error: null }),
    ]);

  const org = orgRes.data as {
    description?: string | null;
    logo_url?: string | null;
    cover_image_url?: string | null;
    cover_theme?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  } | null;

  const orgUpdatedAfterCreation =
    Boolean(org?.created_at && org?.updated_at) &&
    new Date(org!.updated_at!).getTime() -
      new Date(org!.created_at!).getTime() >
      5000;

  const orgDetailsReviewed =
    Boolean(progressRow?.reviewed_org_details_at) ||
    Boolean(org?.description?.trim()) ||
    Boolean(org?.logo_url) ||
    Boolean(org?.cover_image_url) ||
    Boolean(org?.cover_theme) ||
    orgUpdatedAfterCreation;

  const hasTeammate = (membersRes.count ?? 0) > 1;
  const hasCollectionOrBudget =
    (collectionsRes.count ?? 0) > 0 || (budgetsRes.count ?? 0) > 0;
  const hasProject = (spacesRes.count ?? 0) > 0;

  const base = `/app/org/${organizationId}`;
  const tasks: ChecklistTask[] = [];

  if (canManageOrg) {
    tasks.push(
      {
        id: "review_org_details",
        title: "Review organization details",
        description:
          "Confirm your organization name, type, currency, and workspace settings.",
        completed: orgDetailsReviewed,
        optional: false,
        actionHref: `${base}/settings`,
        actionLabel: "Open settings",
      },
      {
        id: "invite_teammate",
        title: "Invite a teammate",
        description:
          "Share your workspace invite code or assign roles in Workspace Access.",
        completed: hasTeammate,
        optional: false,
        actionHref: `${base}/members`,
        actionLabel: "Invite members",
      },
    );
  }

  tasks.push({
    id: "create_collection_or_budget",
    title: "Create a collection or budget",
    description:
      "Start tracking incoming dues or allocate a budget for upcoming expenses.",
    completed: hasCollectionOrBudget,
    optional: false,
    actionHref: `${base}/collections`,
    actionLabel: "Go to collections",
  });

  if (canManageOrg) {
    tasks.push({
      id: "create_project",
      title: "Create a Project",
      description:
        "Group collections, budgets, expenses, and cash advances for an event or initiative.",
      completed: hasProject,
      optional: true,
      actionHref: `${base}/spaces`,
      actionLabel: "Open projects",
    });
  }

  const essentialTasks = tasks.filter((task) => !task.optional);
  const essentialCompleted = essentialTasks.filter(
    (task) => task.completed,
  ).length;
  const essentialTotal = essentialTasks.length;
  const allEssentialComplete =
    essentialTotal > 0 && essentialCompleted === essentialTotal;

  let completedAt = progressRow?.checklist_completed_at ?? null;
  if (allEssentialComplete && !completedAt) {
    completedAt = new Date().toISOString();
    // Persist completion timestamp best-effort so future visits remain collapsed.
    await client
      .from("organization_onboarding_progress")
      .upsert(
        {
          user_id: userId,
          organization_id: organizationId,
          checklist_completed_at: completedAt,
          updated_at: completedAt,
        },
        { onConflict: "user_id,organization_id" },
      );
  }

  return {
    organizationId,
    role,
    checklist: {
      eligible: true,
      dismissed: Boolean(progressRow?.checklist_dismissed),
      completedAt,
      essentialCompleted,
      essentialTotal,
      allEssentialComplete,
      tasks,
    },
    tours,
  };
}

export interface UpdateOrgOnboardingInput {
  checklistDismissed?: boolean;
  markOrgDetailsReviewed?: boolean;
  tourUpdate?: {
    tourId: TourId;
    version: number;
    status: TourStatus;
    step?: number;
  };
}

export async function updateOrgOnboardingState(
  accessToken: string,
  userId: string,
  organizationId: string,
  input: UpdateOrgOnboardingInput,
): Promise<OrgOnboardingState> {
  const { client, role } = await requireActiveMembership(
    accessToken,
    userId,
    organizationId,
  );

  const { data: existing, error: readError } = await client
    .from("organization_onboarding_progress")
    .select(
      "checklist_dismissed, checklist_completed_at, reviewed_org_details_at, tours",
    )
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (readError) {
    throw new AppError(503, "Unable to read onboarding progress.");
  }

  const now = new Date().toISOString();
  const nextTours: Record<string, unknown> =
    existing?.tours &&
    typeof existing.tours === "object" &&
    !Array.isArray(existing.tours)
      ? { ...(existing.tours as Record<string, unknown>) }
      : {};

  if (input.tourUpdate) {
    const { tourId, version, status, step = 0 } = input.tourUpdate;
    nextTours[tourId] = {
      version: Math.max(version, CURRENT_TOUR_VERSIONS[tourId]),
      status,
      step: status === "not_started" ? 0 : Math.max(0, Math.floor(step)),
      updatedAt: now,
    };
  }

  const canManageOrg = role === "owner" || role === "organization_admin";
  if (input.markOrgDetailsReviewed && !canManageOrg) {
    throw new AppError(
      403,
      "Only owners or organization admins can mark organization details as reviewed.",
    );
  }

  const upsertPayload: Record<string, unknown> = {
    user_id: userId,
    organization_id: organizationId,
    tours: nextTours,
    updated_at: now,
  };

  if (input.checklistDismissed !== undefined) {
    upsertPayload.checklist_dismissed = input.checklistDismissed;
  }
  if (input.markOrgDetailsReviewed && canManageOrg) {
    upsertPayload.reviewed_org_details_at =
      existing?.reviewed_org_details_at ?? now;
  }

  const { error: writeError } = await client
    .from("organization_onboarding_progress")
    .upsert(upsertPayload, { onConflict: "user_id,organization_id" });

  if (writeError) {
    throw new AppError(503, "Unable to save onboarding progress.");
  }

  return getOrgOnboardingState(accessToken, userId, organizationId);
}

export async function recordOrgDetailsReviewedBestEffort(
  accessToken: string,
  userId: string,
  organizationId: string,
) {
  try {
    const client = createUserClient(accessToken);
    const now = new Date().toISOString();
    const { data: existing } = await client
      .from("organization_onboarding_progress")
      .select("reviewed_org_details_at")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (existing?.reviewed_org_details_at) return;

    await client.from("organization_onboarding_progress").upsert(
      {
        user_id: userId,
        organization_id: organizationId,
        reviewed_org_details_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,organization_id" },
    );
  } catch {
    // Best-effort only; never block org settings updates.
  }
}
