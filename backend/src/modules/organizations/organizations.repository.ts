import { createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";

function isMembershipCompatibilityError(code?: string) {
  return code === "42703" || code === "PGRST200" || code === "PGRST201" || code === "PGRST204";
}

function canViewInviteCode(role?: string | null): boolean {
  return role === "owner" || role === "organization_admin";
}

function redactMembershipInviteCode<T extends { role?: string; organizations?: any }>(row: T | null): T | null {
  if (!row || !row.organizations || canViewInviteCode(row.role)) return row;
  if (Array.isArray(row.organizations)) {
    return {
      ...row,
      organizations: row.organizations.map((org: Record<string, unknown>) => {
        if (!org || typeof org !== "object") return org;
        const { invite_code: _removed, ...rest } = org;
        return rest;
      }),
    };
  }
  if (typeof row.organizations === "object") {
    const { invite_code: _removed, ...rest } = row.organizations as Record<string, unknown>;
    return { ...row, organizations: rest };
  }
  return row;
}

export async function listMemberships(accessToken: string, userId: string) {
  const client = createUserClient(accessToken);
  let { data, error }: { data: any; error: any } = await client
    .from("organization_members")
    .select("id, profile_id, organization_id, role, display_name, can_submit_expenses, organizations!organization_members_organization_id_fkey(id, name, currency, invite_code, logo_url, cover_image_url, cover_theme, description)")
    .eq("profile_id", userId)
    .eq("status", "active");

  if (error && isMembershipCompatibilityError(error.code)) {
    const retry = await client
      .from("organization_members")
      .select("id, profile_id, organization_id, role, display_name, can_submit_expenses, organizations!organization_members_organization_id_fkey(id, name, currency, invite_code, logo_url, description)")
      .eq("profile_id", userId)
      .eq("status", "active");
    data = retry.data;
    error = retry.error;
  }

  if (error && isMembershipCompatibilityError(error.code)) {
    const retry = await client
      .from("organization_members")
      .select("id, profile_id, organization_id, role, organizations!organization_members_organization_id_fkey(id, name, currency, invite_code)")
      .eq("profile_id", userId)
      .eq("status", "active");
    data = retry.data;
    error = retry.error;
  }

  if (error && isMembershipCompatibilityError(error.code)) {
    // Recover independently of PostgREST's embedded relationship cache.
    const memberships = await client.from("organization_members")
      .select("id, profile_id, organization_id, role")
      .eq("profile_id", userId).eq("status", "active");
    if (!memberships.error) {
      if (!memberships.data.length) return [];
      const organizations = await client.from("organizations")
        .select("id, name, currency, invite_code")
        .in("id", memberships.data.map(member => member.organization_id));
      if (!organizations.error) {
        const byId = new Map(organizations.data.map(org => [org.id, org]));
        if (memberships.data.every(member => byId.has(member.organization_id))) {
          return memberships.data.map(member => redactMembershipInviteCode({ ...member, organizations: byId.get(member.organization_id) })!);
        }
      }
      console.error("[listMemberships] Organization lookup failed", {
        code: organizations.error?.code, missingRows: !organizations.error,
      });
    } else {
      console.error("[listMemberships] Membership lookup failed", { code: memberships.error.code });
    }
    console.error("[listMemberships] Embedded lookup failed", { code: error.code });
    throw new AppError(503, "Could not load your organizations. Please try again.");
  }

  if (error) {
    console.error("[listMemberships] Membership lookup failed", { code: error.code });
    throw new AppError(503, "Could not load your organizations. Please try again.");
  }
  return (data ?? []).map((row: any) => redactMembershipInviteCode(row));
}

export async function findMembership(
  accessToken: string,
  userId: string,
  organizationId: string,
  options?: { includeBranding?: boolean },
) {
  const includeBranding = options?.includeBranding === true;
  const primaryOrgCols = includeBranding
    ? "id, name, currency, invite_code, logo_url, cover_image_url, cover_theme, description"
    : "id, name, currency";
  const client = createUserClient(accessToken);
  let { data, error }: { data: any; error: any } = await client
    .from("organization_members")
    .select(`id, profile_id, organization_id, role, display_name, can_submit_expenses, organizations!organization_members_organization_id_fkey(${primaryOrgCols})`)
    .eq("profile_id", userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (includeBranding && error && isMembershipCompatibilityError(error.code)) {
    const retry = await client
      .from("organization_members")
      .select("id, profile_id, organization_id, role, display_name, can_submit_expenses, organizations!organization_members_organization_id_fkey(id, name, currency, invite_code, logo_url, description)")
      .eq("profile_id", userId)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error && isMembershipCompatibilityError(error.code)) {
    const fallbackOrgCols = includeBranding ? "id, name, currency, invite_code" : "id, name, currency";
    const retry = await client
      .from("organization_members")
      .select(`id, profile_id, organization_id, role, organizations!organization_members_organization_id_fkey(${fallbackOrgCols})`)
      .eq("profile_id", userId)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error && isMembershipCompatibilityError(error.code)) {
    const direct = await client.from("organization_members")
      .select("id, profile_id, organization_id, role")
      .eq("profile_id", userId).eq("organization_id", organizationId).eq("status", "active").maybeSingle();
    if (!direct.error) {
      if (!direct.data) return null;
      const organization = await client.from("organizations")
        .select(includeBranding ? "id, name, currency, invite_code" : "id, name, currency")
        .eq("id", organizationId).maybeSingle();
      if (!organization.error && organization.data) {
        return redactMembershipInviteCode({ ...direct.data, organizations: organization.data });
      }
      console.error("[findMembership] Direct organization lookup failed", {
        code: organization.error?.code, missingRow: !organization.data,
      });
    } else {
      console.error("[findMembership] Direct membership lookup failed", { code: direct.error.code });
    }
    console.error("[findMembership] Membership query failed", { code: error.code, message: error.message });
    throw new AppError(503, "Organization access is temporarily unavailable.");
  }

  if (error) {
    console.error("[findMembership] Membership lookup failed", { code: error.code });
    throw new AppError(503, "Organization access is temporarily unavailable.");
  }
  return redactMembershipInviteCode(data);
}

export async function hasActiveMembership(accessToken: string, userId: string, organizationId: string) {
  const { data, error } = await createUserClient(accessToken).from("organization_members")
    .select("id").eq("profile_id", userId).eq("organization_id", organizationId).eq("status", "active").maybeSingle();
  if (error) {
    console.error("[hasActiveMembership] Membership query failed", { code: error.code, message: error.message });
    throw new AppError(503, "Organization access is temporarily unavailable.");
  }
  return Boolean(data);
}

export function isValidIanaTimeZone(zone: string): boolean {
  const trimmed = zone.trim();
  if (!trimmed || (trimmed !== "UTC" && !trimmed.includes("/"))) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export async function createOrganization(
  accessToken: string,
  name: string,
  currency: string,
  organizationType: string,
  requestId: string,
  timeZone?: string
) {
  const client = createUserClient(accessToken);
  const { data, error } = await client
    .rpc("create_typed_organization", {
      org_type: organizationType,
      request_id: requestId,
      org_name: name,
      org_currency: currency,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to create organization.");
  }
  if (timeZone && data?.id && !data.time_zone) {
    const tzResult = await client.rpc("set_initial_organization_time_zone", {
      p_org_id: data.id,
      p_time_zone: timeZone,
    });
    if (!tzResult.error && tzResult.data) {
      return { ...data, time_zone: tzResult.data };
    }
  }
  return data;
}

export async function joinOrganization(accessToken: string, code: string) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("join_organization_by_code", {
      code,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to join organization.");
  }
  return data;
}

export async function listOrganizationMembers(accessToken: string, organizationId: string) {
  const client = createUserClient(accessToken);

  // 1. Primary: Try relational join including avatar_url
  let { data, error }: { data: any; error: any } = await client
    .from("organization_members")
    .select("id, profile_id, role, status, can_submit_expenses, created_at, profiles(id, display_name, avatar_url)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  // 2. Fallback: If join with avatar_url failed (e.g. avatar_url column missing in schema cache), try without avatar_url
  if (error) {
    console.warn("[listOrganizationMembers] Primary join failed, retrying without avatar_url:", error.message || error);
    const retry = await client
      .from("organization_members")
      .select("id, profile_id, role, status, can_submit_expenses, created_at, profiles(id, display_name)")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    data = retry.data;
    error = retry.error;
  }

  // 3. Fallback: If relational join failed entirely (e.g. cross-table PostgREST join limitation or RLS join issue),
  // query organization_members directly and safely hydrate profiles
  if (error) {
    console.warn("[listOrganizationMembers] Relational query failed, falling back to direct table query:", error.message || error);
    const fallback = await client
      .from("organization_members")
      .select("id, profile_id, role, status, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (fallback.error) {
      console.error("[listOrganizationMembers] Direct member query failed:", fallback.error);
      throw new AppError(503, "Member list is temporarily unavailable.");
    }

    const members = (fallback.data ?? []) as Array<{
      id: string;
      profile_id: string;
      role: any;
      status: any;
      created_at: string;
    }>;

    if (members.length === 0) return [];

    const profileIds = Array.from(new Set(members.map((m) => m.profile_id).filter(Boolean)));
    if (profileIds.length > 0) {
      try {
        let profRes: any = await client
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", profileIds);

        if (profRes.error) {
          profRes = await client
            .from("profiles")
            .select("id, display_name")
            .in("id", profileIds);
        }

        if (!profRes.error && profRes.data) {
          const profileMap = new Map(
            (profRes.data as Array<{ id: string; display_name: string | null; avatar_url?: string | null }>).map((p) => [p.id, p])
          );
          return members.map((m) => ({
            ...m,
            profiles: profileMap.get(m.profile_id) ?? null,
          }));
        }
      } catch (profErr) {
        console.warn("[listOrganizationMembers] Profile hydration skipped:", profErr);
      }
    }

    return members.map((m) => ({
      ...m,
      profiles: null,
    }));
  }

  return data ?? [];
}

export async function updateMemberRole(accessToken: string, membershipId: string, newRole: string) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("update_member_role", {
      p_membership_id: membershipId,
      p_new_role: newRole,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to update member role.");
  }
  return data;
}

export async function listReportingPeriods(accessToken: string, organizationId: string) {
  const { data, error } = await createUserClient(accessToken)
    .from("reporting_periods")
    .select("*")
    .eq("organization_id", organizationId)
    .order("start_date", { ascending: false });
  if (error) throw new AppError(503, "Reporting periods are temporarily unavailable.");
  return data ?? [];
}

export async function createReportingPeriod(
  accessToken: string,
  organizationId: string,
  name: string,
  startDate: string,
  endDate: string,
  isDefault: boolean = false
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("create_reporting_period", {
      p_org_id: organizationId,
      p_name: name,
      p_start_date: startDate,
      p_end_date: endDate,
      p_is_default: isDefault,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to create reporting period.");
  }
  return data;
}

export async function listSpaces(accessToken: string, organizationId: string) {
  const { data, error } = await createUserClient(accessToken)
    .from("spaces")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new AppError(503, "Spaces are temporarily unavailable.");
  return data ?? [];
}

export async function createSpace(
  accessToken: string,
  organizationId: string,
  name: string,
  description?: string
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("create_space", {
      p_org_id: organizationId,
      p_name: name,
      p_description: description || null,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to create space.");
  }
  return data;
}

export async function updateSpace(
  accessToken: string,
  organizationId: string,
  spaceId: string,
  input: { name: string; description?: string; status?: "active" | "archived" }
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("update_space", {
      p_org_id: organizationId,
      p_space_id: spaceId,
      p_name: input.name,
      p_description: input.description || null,
      p_status: input.status || "active",
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to update space.");
  }
  return data;
}

export async function deleteSpace(
  accessToken: string,
  organizationId: string,
  spaceId: string
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("delete_space", {
      p_org_id: organizationId,
      p_space_id: spaceId,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to delete space.");
  }
  return data;
}

export async function updateOrganizationLogo(
  accessToken: string,
  organizationId: string,
  logoUrl: string | null
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("update_organization_logo", {
      p_org_id: organizationId,
      p_logo_url: logoUrl,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to update organization logo.");
  }
  return data;
}

export async function updateOrganizationCover(
  accessToken: string,
  organizationId: string,
  coverImageUrl: string | null,
  coverTheme: string | null
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("update_organization_cover", {
      p_org_id: organizationId,
      p_cover_image_url: coverImageUrl,
      p_cover_theme: coverTheme,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to update organization cover.");
  }
  return data;
}

export async function updateOrganizationDetails(
  accessToken: string,
  organizationId: string,
  input: { name: string; currency?: string; description?: string }
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc(input.description === undefined ? "update_organization" : "update_organization_profile", {
      ...(input.description !== undefined ? { p_description: input.description } : {}),
      p_org_id: organizationId,
      p_name: input.name,
      p_currency: input.currency || null,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to update organization settings.");
  }
  return data;
}

export async function updateOrganizationRegionalSettings(
  accessToken: string,
  organizationId: string,
  input: { currency?: string; timeZone?: string }
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("update_organization_regional_settings", {
      p_org_id: organizationId,
      p_currency: input.currency ?? null,
      p_time_zone: input.timeZone ?? null,
    });
  if (error) {
    if (error.code === "42501") {
      throw new AppError(403, error.message || "Only workspace owners and administrators can update regional settings.");
    }
    throw new AppError(400, error.message || "Unable to update regional settings.");
  }
  return data;
}

export async function regenerateOrganizationInviteCode(
  accessToken: string,
  organizationId: string
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("regenerate_invite_code", {
      p_org_id: organizationId,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to regenerate invite code.");
  }
  return data;
}

export async function checkOrgDeletability(accessToken: string, organizationId: string) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("check_org_deletability", {
      p_org_id: organizationId,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to check organization deletability.");
  }
  return data;
}

export async function transferOrgOwnership(
  accessToken: string,
  organizationId: string,
  targetMemberId: string,
  currentOwnerNewRole: string = "organization_admin"
) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("transfer_organization_ownership", {
      p_org_id: organizationId,
      p_target_member_id: targetMemberId,
      p_current_owner_role: currentOwnerNewRole,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to transfer ownership.");
  }
  return data;
}

export async function deleteOrganization(accessToken: string, organizationId: string) {
  const { data, error } = await createUserClient(accessToken)
    .rpc("delete_organization", {
      p_org_id: organizationId,
    });
  if (error) {
    throw new AppError(400, error.message || "Unable to delete organization.");
  }
  return data;
}
