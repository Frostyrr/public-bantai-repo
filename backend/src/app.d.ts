import type { User } from "@supabase/supabase-js";
declare global {
  namespace Express {
    interface Request {
      auth?: { user: Pick<User, "id" | "user_metadata"> & Partial<User>; accessToken: string; sessionId?: string; aal?: "aal1" | "aal2" };
    }
  }
}
export {};
