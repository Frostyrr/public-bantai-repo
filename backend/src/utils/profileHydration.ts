import { createUserClient } from "../config/supabase";
import { organizationIdentities } from "./identityContext";

export interface HydratedProfile {
  id: string;
  display_name: string | null;
  avatar_url?: string | null;
  username?: string | null;
}

/**
 * Safely hydrate profile metadata (display_name, avatar_url) for a set of user IDs
 * using the caller's Supabase user client. Falls back cleanly if avatar_url is
 * unavailable in the schema cache or if profile hydration fails.
 */
export async function hydrateProfilesById(
  accessToken: string,
  ids: Array<string | null | undefined>
): Promise<Map<string, HydratedProfile>> {
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const profileMap = new Map<string, HydratedProfile>();
  if (uniqueIds.length === 0) return profileMap;

  try {
    const client = createUserClient(accessToken);
    const profRes: { data: unknown[] | null; error: unknown } = await client.rpc("account_identity_labels",{p_ids:uniqueIds});


    if (!profRes.error && Array.isArray(profRes.data)) {
      for (const p of profRes.data as HydratedProfile[]) {
        profileMap.set(p.id, {
          id: p.id,
          display_name: organizationIdentities.getStore()?.get(p.id)?.display_name ?? p.display_name ?? null,
          username:p.username??null,
          avatar_url: p.avatar_url ?? null,
        });
      }
    }
  } catch (err) {
    console.warn("[hydrateProfilesById] Profile hydration skipped:", err);
  }

  return profileMap;
}
