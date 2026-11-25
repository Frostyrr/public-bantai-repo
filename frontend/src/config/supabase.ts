import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { isLegacyRecoveryCallback, legacyRecoveryPath } from "../lib/recoveryRedirect";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith("sb_publishable_") || new URL(url).pathname !== "/") {
  throw new Error("Configure VITE_SUPABASE_URL (project root) and VITE_SUPABASE_PUBLISHABLE_KEY.");
}
export function promptSessionTimeout() {
  toast.error("Your session timed out. Please sign in again.", { id: "session-timed-out", duration: 8000 });
}

// Discard legacy recovery credentials before Auth can load them into the app session.
if (typeof window !== "undefined" && isLegacyRecoveryCallback(window.location.hash)) {
  window.history.replaceState(window.history.state, "", legacyRecoveryPath);
}

export const supabase = createClient(url, key, {
  global: {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.status === 401 && response.url.includes("/auth/v1/token?grant_type=refresh_token")) {
        const error = await response.clone().json().catch(() => null);
        if (typeof error?.message === "string" && error.message.includes("Your session timed out.")) {
          promptSessionTimeout();
        }
      }
      return response;
    },
  },
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
