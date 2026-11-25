import { enforceSourceRestriction, requestTiming } from './middleware/requestTiming';
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { env } from "./constants/env";
import { createServiceClient, createUserClient } from "./config/supabase";
import { authenticate, authenticateForEmailChallenge, inspectJwtClaims } from "./middleware/authenticate";
import AppError from "./utils/AppError";
import { isAllowlistedIp } from "./utils/ipAllowlist";
import errorHandler from "./middleware/errorHandler";
import { createRateLimiter } from "./middleware/rateLimit";
import {
  recordTurnstileSecurityEvent,
  requireTurnstile,
  verifyTurnstileToken,
} from "./services/turnstile";
import organizationRoutes from "./modules/organizations/organizations.routes";
import { emailMfaChallenge, emailMfaSettings } from "./modules/user/emailMfa.routes";
import { recoveryQuestions, securityQuestions } from "./modules/user/securityQuestions.routes";
import {passwordHistoryPublic,passwordHistorySettings} from "./modules/user/passwordHistory.routes";
import userRoutes from "./modules/user/user.routes";
import { personalIdentitySchema, validRegistrationPassword } from "./modules/user/personalIdentity";
import { organizationIdentityContext, globalIdentityContext } from "./utils/identityContext";
import notificationRoutes from "./modules/notifications/notifications.routes";
import adminRoutes from "./modules/admin/admin.routes";
import usernameAvailability from "./modules/user/usernameAvailability.routes";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: env.APP_ORIGIN,
    maxAge: 600,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    exposedHeaders: ["Server-Timing", "X-Request-Id", "Retry-After", "X-Session-Idle-Remaining"],
    allowedHeaders: [
      "Authorization",
      "X-Recovery-Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Request-Id",
      "X-Turnstile-Token",
    ],
  })
);
app.use(requestTiming);
// Apply IP-level restrictions to unauthenticated/auth/inquiry routes so shared Wi-Fi users
// on authenticated routes (/organizations, /user, /admin) are not locked out by another client.
app.use(["/auth/login", "/auth/register", "/auth/recovery-questions", "/auth/password-history/verify", "/auth/email-mfa", "/inquiries"], enforceSourceRestriction);
// Expense submissions may contain base64-encoded 1 MiB attachments.
const deferredUploadPath = /^\/organizations\/[0-9a-f-]{36}\/expenses\/?$/i;
const directExpenseUploadPath = /^\/organizations\/[0-9a-f-]{36}\/expenses\/?$/i;
const expenseSubmissionLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: "expense-submit",
  message: "Too many expense submissions. Please wait a moment and try again.",
});
const expenseUploadParser = express.json({ limit: "4220kb" });
const defaultJsonParser = express.json({ limit: "512kb" });
app.use((req, res, next) => {
  if ((req.method === "PATCH" && req.path === "/user/profile") ||
      (req.method === "POST" && deferredUploadPath.test(req.path))) {
    next();
    return;
  }
  defaultJsonParser(req, res, next);
});
app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
const authLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyPrefix: "auth_login",
  message: "Too many login attempts. Please wait 15 minutes before trying again.",
});
const loginIdentifier = z.union([z.email().max(320), z.string().regex(/^[a-z][a-z0-9]{5,19}$/i)]);
const loginSchema = z.object({
  identifier: z.string().trim().pipe(loginIdentifier).optional(),
  email: z.string().trim().email().max(320).optional(),
  password: z.string().min(1).max(1024),
  captchaToken: z.string().trim().min(1).max(4096).optional(),
});
app.post("/auth/login", (req, res, next) => {
  if (isAllowlistedIp(req.ip)) { next(); return; }
  authLoginLimiter(req, res, next);
}, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.identifier && !parsed.data.email)) {
      res.status(400).json({ message: "Please enter a valid username or email and password." });
      return;
    }

    const { identifier, email: legacyEmail, password, captchaToken } = parsed.data;
    const identity = (identifier ?? legacyEmail)!;
    const verifyInExpress = env.TURNSTILE_VERIFY_LOGIN_IN_EXPRESS === "true";
    const service = createServiceClient();
    if (!service) {
      res.status(503).json({ message: "Sign-in is temporarily unavailable. Please try again." });
      return;
    }

    function restricted(retryAfter: number) {
      if (retryAfter <= 0) return false;
      res.locals.sourceRestrictionBlocked = true;
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("Cache-Control", "no-store");
      res.status(429).json({ message: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds.`, code: "login_restricted", retryAfterSeconds: retryAfter });
      return true;
    }

    if (verifyInExpress) {
      const verification = await verifyTurnstileToken({
        token: captchaToken,
        remoteIp: req.ip ?? null,
        expectedAction: "login",
      });
      if (!verification.success) {
        const failureCategory = verification.failureCategory ?? "invalid_token";
        const status =
          failureCategory === "verification_unavailable" || failureCategory === "configuration_error"
            ? 503
            : failureCategory === "hostname_mismatch" || failureCategory === "action_mismatch"
            ? 403
            : 400;
        recordTurnstileSecurityEvent({
          req,
          route: "/auth/login",
          failureCategory,
          httpStatus: status,
          expectedAction: "login",
        });
        res.status(status).json({
          message:
            status === 503
              ? "Security verification is temporarily unavailable. Please try again."
              : "Security verification failed. Please complete the challenge and try again.",
          code: failureCategory,
        });
        return;
      }
    }

    let email = identity;
    const usesUsername = !identity.includes("@");
    let usernameFound = true;
    if (usesUsername) {
      const result = await service.rpc("resolve_login_username", { p_username: identity });
      if (!result || result.error) {
        res.status(503).json({ message: "Sign-in is temporarily unavailable. Please try again." });
        return;
      }
      usernameFound = typeof result.data === "string" && result.data.length > 0;
      email = usernameFound ? result.data : "unassigned-username@example.invalid";
    }

    const restrictionArgs = {
      p_email: usernameFound ? email : null,
      p_identifier: identity,
      p_ip: isAllowlistedIp(req.ip) ? null : req.ip ?? null,
    };
    async function readRestriction() {
      const { data, error } = await service!.rpc("bantai_login_restriction", restrictionArgs);
      if (error || typeof data?.retry_after !== "number") {
        throw new AppError(503, "Sign-in is temporarily unavailable. Please try again.");
      }
      return data.retry_after as number;
    }
    if (restricted(await readRestriction())) return;

    // Forward captchaToken to Supabase Auth when Supabase native CAPTCHA is handling verification
    // so the single-use Turnstile token is never double-verified.
    const { data, error } = await createUserClient().auth.signInWithPassword({
      email,
      password,
      options: !verifyInExpress && captchaToken ? { captchaToken } : undefined,
    });
    if (error || !data.session || !usernameFound) {
      const errorMsg = error?.message || "Invalid login credentials.";
      if (errorMsg.toLowerCase().includes("captcha")) {
        recordTurnstileSecurityEvent({
          req,
          route: "/auth/login",
          failureCategory: "supabase_captcha_rejected",
          httpStatus: 400,
          expectedAction: "login",
        });
        res.status(400).json({
          message: "Security verification failed. Please complete the challenge and try again.",
        });
        return;
      }
      if (error?.code === "invalid_credentials" || (!usernameFound && !error && data.session)) {
        const requestId = res.getHeader("X-Request-Id");
        const { data: restriction, error: writeError } = await service.rpc("bantai_record_login_failure", {
          ...restrictionArgs, p_request_id: typeof requestId === "string" ? requestId : null,
          p_user_agent: req.get("User-Agent") ?? null,
        });
        if (writeError || typeof restriction?.retry_after !== "number") {
          throw new AppError(503, "Sign-in is temporarily unavailable. Please try again.");
        }
        res.locals.credentialFailureRecorded = true;
        if (restricted(restriction.retry_after)) return;
        const remaining = typeof restriction.attempts_remaining === "number" ? restriction.attempts_remaining : null;
        res.status(401).json({
          message: remaining !== null && remaining <= 2
            ? `Invalid username or password. ${remaining} attempt${remaining === 1 ? "" : "s"} left before a temporary lock.`
            : "Invalid username or password.",
          code: restriction.suggest_recovery === true ? "recovery_suggested" : "invalid_credentials",
          attemptsRemaining: remaining,
        });
        return;
      }
      res.status(401).json({ message: usesUsername ? "Invalid username or password." : errorMsg });
      return;
    }
    if (restricted(await readRestriction())) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (err) {
    next(err);
  }
});
const turnstileVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  keyPrefix: "turnstile_verify",
  message: "Too many security verification requests. Please wait a moment and try again.",
});
app.post(
  "/auth/turnstile/verify",
  turnstileVerifyLimiter,
  requireTurnstile(),
  (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ verified: true });
  }
);
const inquiryLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "contact_inquiry",
  message: "Too many inquiries submitted. Please wait 15 minutes before trying again.",
});
const inquirySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  orgName: z.string().trim().max(160).optional(),
  inquiryType: z.enum(["officer", "treasurer", "pricing", "other"]),
  message: z.string().trim().min(1).max(4000),
});
app.post(
  "/inquiries",
  inquiryLimiter,
  requireTurnstile({ action: "contact_inquiry" }),
  (req, res) => {
    const parsed = inquirySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Please complete all required inquiry fields." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ ok: true, message: "Inquiry received." });
  }
);
app.use("/auth/username-availability", usernameAvailability);
app.use("/auth/email-mfa", authenticateForEmailChallenge, emailMfaChallenge);
app.post("/auth/register",createRateLimiter({windowMs:15*60_000,max:10,keyPrefix:"registration",message:"Too many signup attempts. Please wait and try again."}),async(req,res)=>{
  const input=personalIdentitySchema.extend({email:z.email(),password:z.string().refine(validRegistrationPassword,"Use a longer passphrase or mix letters, numbers, and symbols."),captchaToken:z.string().min(1)}).parse(req.body);
  const {email,password,captchaToken,...identity}=input;
  const {error}=await createUserClient().auth.signUp({email,password,options:{captchaToken,data:{bantai_identity:identity},emailRedirectTo:env.APP_ORIGIN+"/auth/callback"}});
  if (error) {
    if (error.code === "user_already_exists") {
      res.status(400).json({ message: "Check your email or sign in with your existing account." });
      return;
    }
    if (error.message?.toLowerCase().includes("captcha")) {
      res.status(400).json({ message: "Security verification failed. Please complete the challenge and try again." });
      return;
    }
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      res.status(429).json({ message: "Too many signup emails sent. Please wait a moment and try again." });
      return;
    }
    res.status(400).json({ message: "Could not create your account. Check your details or try a different username." });
    return;
  }
  res.setHeader("Cache-Control","no-store");res.sendStatus(204);
});
app.use("/auth/recovery-questions", recoveryQuestions);
app.use("/auth/password-history",passwordHistoryPublic);
app.use("/user/password-history",authenticate,passwordHistorySettings);
app.use("/user/security-questions", authenticate, securityQuestions);
app.use("/user/email-mfa", authenticate, emailMfaSettings);
app.use("/user", authenticate, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
}, userRoutes);
app.use("/organizations", authenticate, organizationIdentityContext, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
}, (req, res, next) => {
  if (req.method === "POST" && directExpenseUploadPath.test(req.originalUrl.split("?")[0])) {
    expenseSubmissionLimiter(req, res, (err?: unknown) => {
      if (err) { next(err); return; }
      expenseUploadParser(req, res, next);
    });
    return;
  }
  next();
}, organizationRoutes);
app.use("/notifications", authenticate, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
}, notificationRoutes);
app.use("/admin", authenticate, globalIdentityContext, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
}, adminRoutes);
app.use((_req, res) => { res.status(404).json({ message: "Endpoint not found." }); });
app.use(errorHandler);
export default app;
