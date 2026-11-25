import { createHash, createHmac, randomInt } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { env } from "../../constants/env";
import { createServiceClient, createUserClient } from "../../config/supabase";
import { createRateLimiter } from "../../middleware/rateLimit";
import AppError from "../../utils/AppError";
import { openMfaAddressWithPreviousKey, sealMfaAddress } from "./emailMfaAddress";

export const emailMfaChallenge = Router();
export const emailMfaSettings = Router();
const emailMfaLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  keyPrefix: "email_mfa",
  message: "Too many email verification attempts. Please wait and try again.",
});
emailMfaChallenge.use(emailMfaLimiter);
emailMfaSettings.use(emailMfaLimiter);

function context(req: Request) {
  const identity = req.auth;
  const service = createServiceClient();
  if (!identity?.sessionId || !service) throw new AppError(503, "Verification is temporarily unavailable.");
  return { identity, service, args: { p_user: identity.user.id, p_session: identity.sessionId } };
}

function deliveryConfigured() {
  return Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL && env.EMAIL_MFA_HMAC_KEY && env.EMAIL_MFA_ENCRYPTION_KEY);
}

function digest(session: string, code: string) {
  if (!env.EMAIL_MFA_HMAC_KEY) throw new AppError(503, "Email verification is temporarily unavailable.");
  return createHmac("sha256", env.EMAIL_MFA_HMAC_KEY)
    .update("bantai-email-mfa:" + session + ":" + code)
    .digest("hex");
}

function encryptionKey() {
  if (!env.EMAIL_MFA_ENCRYPTION_KEY) throw new AppError(503, "Email verification is temporarily unavailable.");
  return Buffer.from(env.EMAIL_MFA_ENCRYPTION_KEY, "hex");
}

function openAddress(userId: string, ciphertext: string) {
  const previous = env.EMAIL_MFA_PREVIOUS_ENCRYPTION_KEY;
  return openMfaAddressWithPreviousKey(encryptionKey(),
    previous ? Buffer.from(previous, "hex") : undefined, userId, ciphertext);
}

function addressHash(email: string) {
  return createHash("sha256").update(email, "utf8").digest("hex");
}

async function sendCode(email: string, code: string) {
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY!, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        sender: { name: "Bantai", email: env.BREVO_SENDER_EMAIL },
        to: [{ email }],
        subject: "Your Bantai sign-in code",
        htmlContent: '<div style="background:#f4f4f5;padding:24px;font-family:Arial,sans-serif;color:#18181b">'
          + '<div style="background:white;max-width:480px;margin:auto;padding:24px;border-radius:12px">'
          + '<p><strong>Bantai</strong></p><h1 style="font-size:24px">Verify your sign-in</h1>'
          + '<p>Enter this code in Bantai. It expires in 5 minutes.</p>'
          + '<p style="font-size:32px;letter-spacing:6px;font-weight:bold">' + code + '</p>'
          + '<p>If you did not request this code, ignore this email and consider changing your password.</p></div></div>',
      }),
    });
    if (response.ok) return;
  } catch {
    // No delivery payloads, addresses, or OTPs in logs or responses.
  }
  throw new AppError(503, "Could not send a verification code. Try again in one minute.");
}

emailMfaChallenge.get("/", async (req, res) => {
  const { args, service } = context(req);
  const { data, error } = await service.rpc("bantai_email_mfa_enabled", { p_user: args.p_user });
  if (error) throw new AppError(503, "Verification is temporarily unavailable.");
  res.json({ enabled: data === true, sessionId: args.p_session });
});

function recordOtpEvent(
  req: Request,
  service: NonNullable<ReturnType<typeof createServiceClient>>,
  actorId: string,
  action: "OTP_SENT" | "OTP_FAILED",
  enroll: boolean,
) {
  const requestId = req.res?.getHeader("X-Request-Id");
  const sent = action === "OTP_SENT";
  void service.rpc("record_authenticated_security_event", {
    p_actor_id: actorId,
    p_category: "auth",
    p_severity: "low",
    p_action: action,
    p_outcome: sent ? "flagged" : "failed",
    p_http_status: sent ? 204 : 400,
    p_route: req.baseUrl + req.path,
    p_request_id: typeof requestId === "string" ? requestId : null,
    p_event_source: "auth",
    p_metadata: { purpose: enroll ? "email_mfa_enrollment" : "email_mfa_login" },
    p_enforcement_eligible: false,
  }).then(() => undefined, () => undefined);
}

const issueCode = (enroll: boolean): RequestHandler => async (req, res) => {
  // Omitted method remains compatible with existing settings/older clients.
  z.object({ method: z.literal("email").optional() }).parse(req.body ?? {});
  if (!deliveryConfigured()) throw new AppError(503, "Email verification is temporarily unavailable.");
  const { args, identity, service } = context(req);
  let ciphertext: string | null = null;
  let emailHash: string | null = null;
  if (enroll) {
    const { data, error } = await createUserClient().auth.getUser(identity.accessToken);
    const email = data.user?.email;
    if (error || !email || !data.user?.email_confirmed_at || data.user.id !== args.p_user) {
      throw new AppError(403, "Verify your account before changing this setting.");
    }
    ciphertext = sealMfaAddress(encryptionKey(), args.p_user, email);
    emailHash = addressHash(email);
  }
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  const { data, error } = await service.rpc("bantai_issue_email_mfa", {
    ...args, p_digest: digest(args.p_session, code), p_enroll: enroll, p_aal: identity.aal,
    p_ciphertext: ciphertext, p_email_hash: emailHash,
  });
  if (error) throw new AppError(503, "Verification is temporarily unavailable.");
  if (typeof data !== "string") throw new AppError(429, "A new code is unavailable. Wait and try again.");
  await sendCode(openAddress(args.p_user, data), code);
  recordOtpEvent(req, service, args.p_user, "OTP_SENT", enroll);
  res.sendStatus(204);
};

const verifyCode = (enroll: boolean): RequestHandler => async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^[0-9]{6}$/), method: z.literal("email").optional() }).parse(req.body);
  const { args, identity, service } = context(req);
  let ciphertext: string | null = null;
  let emailHash: string | null = null;
  if (enroll) {
    const pending = await service.rpc("bantai_email_mfa_pending_address", args);
    if (pending.error) throw new AppError(503, "Verification is temporarily unavailable.");
    if (typeof pending.data === "string") {
      ciphertext = pending.data;
      emailHash = addressHash(openAddress(args.p_user, ciphertext));
    }
  }
  const { data, error } = await service.rpc("bantai_verify_email_mfa", {
    ...args, p_digest: digest(args.p_session, code), p_enroll: enroll, p_aal: identity.aal,
    p_ciphertext: ciphertext, p_email_hash: emailHash,
  });
  if (error) throw new AppError(503, "Verification is temporarily unavailable.");
  if (data !== true) {
    recordOtpEvent(req, service, args.p_user, "OTP_FAILED", enroll);
    throw new AppError(400, "That code is invalid or expired.");
  }
  res.sendStatus(204);
};

emailMfaChallenge.post("/send", issueCode(false));
emailMfaChallenge.post("/verify", verifyCode(false));
emailMfaSettings.post("/enroll/send", issueCode(true));
emailMfaSettings.post("/enroll/verify", verifyCode(true));

emailMfaSettings.delete("/", async (req, res) => {
  const { args, identity, service } = context(req);
  const { data, error } = await service.rpc("bantai_disable_email_mfa", {
    ...args, p_aal: identity.aal,
  });
  if (error) throw new AppError(503, "Could not update verification settings.");
  if (data !== true) throw new AppError(403, "Verify your account before changing this setting.");
  res.sendStatus(204);
});

emailMfaSettings.post("/trust-authenticator", async (req, res) => {
  const { factorId } = z.object({ factorId: z.uuid() }).parse(req.body);
  const { args, identity, service } = context(req);
  const { data, error } = await service.rpc("bantai_trust_email_mfa_totp", {
    ...args, p_aal: identity.aal, p_factor: factorId,
  });
  if (error) throw new AppError(503, "Could not update verification settings.");
  if (data !== true) throw new AppError(403, "Verify your account before changing this setting.");
  res.sendStatus(204);
});
