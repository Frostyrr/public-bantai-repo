import { createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";

export async function getUserProfile(accessToken: string, userId: string) {
  const { data, error } = await createUserClient(accessToken)
    .from("profiles")
    .select("id, display_name, avatar_url, role, created_at, onboarding_step")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new AppError(503, "Failed to retrieve user profile.");
  }
  return data;
}

export async function updateUserProfile(
  accessToken: string,
  userId: string,
  payload: { avatarUrl?: string | null }
) {
  const updates: Record<string, unknown> = {};
  if (payload.avatarUrl !== undefined) {
    updates.avatar_url = payload.avatarUrl;
  }

  const client = createUserClient(accessToken);
  const { data, error } = await client
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select("id, avatar_url, onboarding_step")
    .single();

  if (error) {
    throw new AppError(400, error.message || "Failed to update profile.");
  }

  // Sync only compact URLs (or removal) to auth metadata; never bloat JWTs with base64 data URLs.
  if (payload.avatarUrl === null || (typeof payload.avatarUrl === "string" && !payload.avatarUrl.startsWith("data:"))) {
    try {
      await client.auth.updateUser({ data: { avatar_url: payload.avatarUrl } });
    } catch {
      // Non-critical if auth metadata sync fails as database profile is the authority
    }
  }

  return data;
}

export async function getUserPreferences(accessToken: string, userId: string) {
  const { data, error } = await createUserClient(accessToken)
    .from("user_preferences")
    .select("theme, reduced_motion, default_organization_id, notifications")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new AppError(503, "Failed to retrieve preferences.");
  }

  return (
    data ?? {
      theme: "dark",
      reduced_motion: false,
      default_organization_id: null,
      notifications: {
        email_approvals: true,
        email_payments: true,
        email_invites: true,
        in_app_approvals: true,
        in_app_payments: true,
        in_app_invites: true,
      },
    }
  );
}

export async function completeAccountOnboarding(accessToken: string, theme: "light" | "dark" | "system") {
  const { data, error } = await createUserClient(accessToken).rpc("complete_account_onboarding", { p_theme: theme });
  if (error?.code === "PT409") throw new AppError(409, error.message);
  if (error || !["light", "dark", "system"].includes(data)) {
    throw new AppError(503, "Could not save your appearance preference. Try again.");
  }
  return data;
}

export async function updateUserPreferences(
  accessToken: string,
  userId: string,
  payload: {
    theme?: string;
    reducedMotion?: boolean;
    defaultOrganizationId?: string | null;
    notifications?: Record<string, boolean>;
  }
) {
  const current = payload.notifications ? await getUserPreferences(accessToken, userId) : null;

  const updates: {
    user_id: string;
    theme?: string;
    reduced_motion?: boolean;
    default_organization_id?: string | null;
    notifications?: Record<string, boolean>;
    updated_at: string;
  } = {
    user_id: userId,
    theme: payload.theme,
    reduced_motion: payload.reducedMotion,
    default_organization_id: payload.defaultOrganizationId,
    notifications: current ? { ...current.notifications, ...payload.notifications } : undefined,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await createUserClient(accessToken)
    .from("user_preferences")
    .upsert(updates, { onConflict: "user_id" })
    .select("theme, reduced_motion, default_organization_id, notifications")
    .single();

  if (error) {
    throw new AppError(400, error.message || "Failed to update preferences.");
  }

  return data;
}

export async function leaveOrganization(accessToken: string, orgId: string) {
  const { data, error } = await createUserClient(accessToken).rpc("leave_organization", {
    p_org_id: orgId,
  });

  if (error) {
    throw new AppError(400, error.message || "Failed to leave organization.");
  }

  return data;
}

export async function deletePersonalAccount(accessToken: string) {
  const { data, error } = await createUserClient(accessToken).rpc("delete_personal_account");

  if (error) {
    throw new AppError(400, error.message || "Failed to delete account.");
  }

  return data;
}
