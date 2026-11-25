import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4004),
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  SUPABASE_URL: z.url().refine(value => new URL(value).pathname === "/", "Use the project root URL, without /rest/v1"),
  SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_"),
  AUTH_JWKS_ENABLED: z.enum(["true", "false"]).default("false"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  BREVO_API_KEY: z.string().min(1).optional(),
  BREVO_SENDER_EMAIL: z.email().optional(),
  EMAIL_MFA_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  EMAIL_MFA_PREVIOUS_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  EMAIL_MFA_HMAC_KEY: z.string().min(32).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  KV_REST_API_URL: z.string().url().optional(),
  KV_REST_API_TOKEN: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  TURNSTILE_EXPECTED_HOSTNAMES: z.string().optional(),
  TURNSTILE_VERIFY_LOGIN_IN_EXPRESS: z.enum(["true", "false"]).optional(),
  // Comma-separated IPs that are never IP-blocked (account lockouts still apply).
  ADMIN_IP_ALLOWLIST: z.string().optional(),
  PASSWORD_HISTORY_ENABLED: z.enum(["true","false"]).default("false"),
  // Operator assertion after hosted native current-password rejection is tested.
  PASSWORD_HISTORY_NATIVE_CURRENT_PASSWORD_REQUIRED: z.enum(["true","false"]).default("false"),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === "production" && !data.SUPABASE_SERVICE_ROLE_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SUPABASE_SERVICE_ROLE_KEY"],
      message: "Required in production for durable shared rate-limit and security-event enforcement",
    });
  }
});
const result = schema.safeParse(process.env);
if (!result.success) {
  throw new Error("Invalid environment configuration: " + result.error.issues.map(issue => issue.path.join(".") + ": " + issue.message).join("; "));
}
export const env = result.data;
