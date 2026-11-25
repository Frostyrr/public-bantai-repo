import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../constants/env";

// Never retain a user's session on a shared server client.
export const createUserClient = (accessToken?: string) => createClient(
  env.SUPABASE_URL,
  env.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  },
);

// Server-only client for privileged security-enforcement RPCs when configured.
let cachedServiceClientKey: string | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedServiceClient: SupabaseClient<any, "public", any> | null = null;

export const createServiceClient = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const url = process.env.SUPABASE_URL ?? env.SUPABASE_URL;
  const cacheKey = `${url}::${key}`;
  if (cachedServiceClient && cachedServiceClientKey === cacheKey) {
    return cachedServiceClient;
  }
  cachedServiceClientKey = cacheKey;
  cachedServiceClient = createClient(
    url,
    key,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
  return cachedServiceClient;
};
