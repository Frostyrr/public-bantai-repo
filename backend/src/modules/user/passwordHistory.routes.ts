import { createHmac, randomInt } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../constants/env";
import { createUserClient } from "../../config/supabase";
import { inspectJwtClaims } from "../../middleware/authenticate";
import { createRateLimiter } from "../../middleware/rateLimit";
import AppError from "../../utils/AppError";
import { historyAction, historyEnabled, getHistoryRollout, PASSWORD_HISTORY_BACKEND_VERSION, newAuthorization, managedPasswordUpdate } from "./passwordHistory.service";
import { validRegistrationPassword } from "./personalIdentity";
const strongPassword = z.string().min(8).max(64).refine(v => Buffer.byteLength(v, "utf8") <= 72).refine(validRegistrationPassword, "Use a longer passphrase or mix letters, numbers, and symbols.");
export const passwordHistoryPublic = Router();
export const passwordHistorySettings = Router();
const limiter = createRateLimiter({ windowMs: 15 * 60000, max: 20, keyPrefix: "password_history", message: "Too many password verification requests. Wait 15 minutes and try again." });
passwordHistoryPublic.get("/status", async (_req, res) => {
  res.setHeader("Cache-Control","no-store");
  const rollout=await getHistoryRollout();
  res.json({protocol:2,backendVersion:PASSWORD_HISTORY_BACKEND_VERSION,mode:rollout.mode,
    enabled:rollout.mode!=="legacy"||historyEnabled(),frozen:rollout.mode==="frozen",
    acceptingChanges:rollout.mode==="legacy"?!historyEnabled():rollout.mode==="managed"&&historyEnabled()&&env.PASSWORD_HISTORY_NATIVE_CURRENT_PASSWORD_REQUIRED==="true"});
});
for (const router of [passwordHistoryPublic, passwordHistorySettings])
  router.use(limiter, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
passwordHistoryPublic.post("/verify", async (req, res) => {
  await getHistoryRollout();
  const { email, token } = z.object({ email: z.email(), token: z.string().regex(/^[0-9]{6,10}$/) }).parse(req.body);
  // A recovery grant can only originate from this specific native OTP purpose.
  // No access token (including a regular OTP login token) can mint this grant.
  const { data, error } = await createUserClient().auth.verifyOtp({ email, token, type: "recovery" });
  if (error || !data.session || !data.user?.email_confirmed_at)
    throw new AppError(401, "Invalid or expired recovery code. Request a fresh code.");
  const jwt = inspectJwtClaims(data.session.access_token);
  if (!jwt.sessionId || jwt.isExpired)
    throw new AppError(401, "Recovery verification expired. Request a fresh code.");
  req.auth = { user: data.user, accessToken: data.session.access_token, sessionId: jwt.sessionId, aal: jwt.aal === "aal2" ? "aal2" : "aal1" };
  const proof = newAuthorization();
  await historyAction(req, "issue_reset", { id: proof.id, digest: proof.digest });
  res.json({ authorization: proof.token, access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
passwordHistorySettings.get("/", async (req, res) => res.json(await historyAction(req, "status")));
passwordHistorySettings.post("/send", async (req, res) => {
  await getHistoryRollout();
  if (!env.EMAIL_MFA_HMAC_KEY || !env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)
    throw new AppError(503, "Password verification email is unavailable.");
  const { data, error } = await createUserClient().auth.getUser(req.auth!.accessToken);
  if (error || !data.user?.email || !data.user.email_confirmed_at)
    throw new AppError(403, "Verify your account email first.");
  const code = String(randomInt(1000000)).padStart(6, "0");
  const digest = createHmac("sha256", env.EMAIL_MFA_HMAC_KEY).update(`bantai-password:${req.auth!.user.id}:${req.auth!.sessionId}:${code}`).digest("hex");
  const result = await historyAction(req, "send", { digest });
  if (result.limited) {
    res.setHeader("Retry-After", "60");
    throw new AppError(429, "Wait one minute before requesting another code.");
  }
  let sent = false;
  try {
    sent = (await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", signal: AbortSignal.timeout(5000), headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ sender: { name: "Bantai", email: env.BREVO_SENDER_EMAIL }, to: [{ email: data.user.email }], subject: "Authorize your Bantai password change", textContent: `Your password-change verification code is ${code}. It expires in 5 minutes. Enter it only in Bantai. If you did not request this, ignore this email.` }) })).ok;
  }
  catch { /* Do not log delivery bodies, codes, or credentials. */ }
  if (!sent)
    throw new AppError(503, "Could not send a code. Wait one minute and try again.");
  res.sendStatus(204);
});
passwordHistorySettings.post("/confirm", async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^[0-9]{6}$/) }).parse(req.body);
  if (!env.EMAIL_MFA_HMAC_KEY)
    throw new AppError(503, "Password verification is unavailable.");
  const proof = newAuthorization();
  const codeDigest = createHmac("sha256", env.EMAIL_MFA_HMAC_KEY).update(`bantai-password:${req.auth!.user.id}:${req.auth!.sessionId}:${code}`).digest("hex");
  if (!(await historyAction(req, "confirm", { codeDigest, id: proof.id, digest: proof.digest })).ok)
    throw new AppError(400, "That code is invalid or expired. Request a fresh code.");
  res.json({ authorization: proof.token });
});
passwordHistorySettings.post("/change", async (req, res) => {
  const body = z.object({ password: strongPassword, currentPassword: z.string().min(1).max(1024), nonce: z.string().regex(/^[0-9]{6,10}$/).optional(), authorization: z.string().max(120) }).parse(req.body);
  await managedPasswordUpdate(req, body, "change");
  res.sendStatus(204);
});
passwordHistorySettings.post("/set", async (req, res) => {
  let authUser = req.auth!.user;
  if (!Array.isArray(authUser.identities) && !authUser.app_metadata) {
    const { data, error } = await createUserClient().auth.getUser(req.auth!.accessToken);
    if (error || !data.user || data.user.id !== authUser.id) {
      throw new AppError(401, "Your session is invalid or expired.");
    }
    authUser = data.user;
  }
  const identityProviders = Array.isArray(authUser.identities)
    ? authUser.identities.map((i: { provider?: string }) => i.provider).filter(Boolean)
    : [];
  const appProviders = Array.isArray(authUser.app_metadata?.providers)
    ? (authUser.app_metadata.providers as string[])
    : authUser.app_metadata?.provider
      ? [authUser.app_metadata.provider as string]
      : [];
  const hasEmailProvider = identityProviders.includes("email") || appProviders.includes("email");
  if (hasEmailProvider) {
    throw new AppError(409, "Your account already has a password. Use Change password instead.");
  }
  const body = z.object({ password: strongPassword, nonce: z.string().regex(/^[0-9]{6,10}$/).optional(), authorization: z.string().max(120) }).parse(req.body);
  await managedPasswordUpdate(req, body, "change");
  res.sendStatus(204);
});
