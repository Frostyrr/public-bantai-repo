import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { env } from "../../constants/env";
import { createServiceClient, createUserClient } from "../../config/supabase";
import {
  inspectJwtClaims,
  readBearerToken,
} from "../../middleware/authenticate";
import { createRateLimiter } from "../../middleware/rateLimit";
import AppError from "../../utils/AppError";
import {getHistoryRollout,usesManagedHistory,historyAction,authorizationData,requireRecoveryProof,managedPasswordUpdate} from "./passwordHistory.service";
import {
  checkAnswer,
  hashAnswer,
  normalizeAnswer,
} from "./securityQuestionAnswers";
import { validRegistrationPassword } from "./personalIdentity";

export const securityQuestions = Router();
export const recoveryQuestions = Router();
const answersSchema = z
  .array(
    z
      .string()
      .max(200)
      .refine(
        (v) => normalizeAnswer(v).length >= 2,
        "Use at least two characters.",
      ),
  )
  .length(3);
const selectionsSchema = z
  .array(z.number().int().min(1).max(8))
  .length(3)
  .refine((ids) => new Set(ids).size === 3);
const limiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 30,
  keyPrefix: "security_questions",
  message: "Too many recovery requests. Wait 15 minutes and try again.",
});

// These sessions belong to the isolated recovery client, never the shared Axios client.
export const recoveryIdentity: RequestHandler = async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const token = readBearerToken(req.headers.authorization);
    if (!token)
      throw new AppError(401, "Verify your email recovery code first.");
    const { data, error } = await createUserClient().auth.getUser(token);
    if (error || !data.user?.email_confirmed_at)
      throw new AppError(401, "Recovery session expired. Request a new code.");
    const jwt = inspectJwtClaims(token);
    // getUser above verifies this exact token before its claims are trusted.
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    const freshOtp =
      Array.isArray(claims.amr) &&
      claims.amr.some(
        (amr: { method?: string; timestamp?: number }) =>
          amr.method === "otp" &&
          typeof amr.timestamp === "number" &&
          Date.now() / 1000 - amr.timestamp >= -60 &&
          Date.now() / 1000 - amr.timestamp < 300,
      );
    if (!jwt.sessionId || jwt.isExpired || !freshOtp)
      throw new AppError(
        401,
        "Recovery session expired. Request a new email code.",
      );
    req.auth = {
      user: data.user,
      accessToken: token,
      sessionId: jwt.sessionId,
      aal: jwt.aal === "aal2" ? "aal2" : "aal1",
    };
    await requireRecoveryProof(req);
    next();
  } catch (err) {
    next(err);
  }
};

async function action(req: Request, operation: string, payload: object = {}) {
  const identity = req.auth;
  const service = createServiceClient();
  if (!identity?.sessionId || !service)
    throw new AppError(503, "Recovery questions are temporarily unavailable.");
  const { data, error } = await service.rpc("bantai_sq_action", {
    p_user: identity.user.id,
    p_session: identity.sessionId,
    p_aal: identity.aal,
    p_action: operation,
    p_data: payload,
  });
  if (error)
    throw new AppError(
      403,
      "Could not complete verification. Verify a fresh code using your selected verification method, then try again.",
    );
  return data;
}
function digest(req: Request, code: string) {
  if (!env.EMAIL_MFA_HMAC_KEY)
    throw new AppError(503, "Email verification is temporarily unavailable.");
  return createHmac("sha256", env.EMAIL_MFA_HMAC_KEY)
    .update(
      `bantai-questions:${req.auth!.user.id}:${req.auth!.sessionId}:${code}`,
    )
    .digest("hex");
}
const management = Router();
management.use(limiter, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
management.get("/", async (req, res) => {
  res.json(await action(req, "status"));
});
management.post("/confirm-authenticator", async (req, res) => {
  const { data, error } = await createUserClient().auth.getUser(req.auth!.accessToken);
  if (error || data.user?.id !== req.auth!.user.id) throw new AppError(401, "Verify your sign-in again.");
  const claims = JSON.parse(Buffer.from(req.auth!.accessToken.split(".")[1], "base64url").toString());
  const fresh = Array.isArray(claims.amr) && claims.amr.some((entry: {method?: string; timestamp?: number}) =>
    entry.method === "totp" && typeof entry.timestamp === "number" && Date.now()/1000-entry.timestamp >= 0 && Date.now()/1000-entry.timestamp < 300);
  if (claims.aal !== "aal2" || !fresh) throw new AppError(403, "Verify a fresh authenticator code first.");
  await action(req, "authorize_totp");
  res.sendStatus(204);
});
management.post("/send", async (req, res) => {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)
    throw new AppError(503, "Email verification is temporarily unavailable.");
  const { data, error } = await createUserClient().auth.getUser(
    req.auth!.accessToken,
  );
  if (error || !data.user?.email || !data.user.email_confirmed_at)
    throw new AppError(403, "Verify your account email first.");
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  const result = await action(req, "send", { digest: digest(req, code) });
  if (result.limited) {
    res.setHeader("Retry-After", "60");
    throw new AppError(429, "Wait one minute before requesting another code.");
  }
  let sent = false;
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Bantai", email: env.BREVO_SENDER_EMAIL },
        to: [{ email: data.user.email }],
        subject: "Confirm your Bantai recovery question changes",
        textContent: `Your recovery question verification code is ${code}. It expires in 5 minutes. Only enter it in Bantai. If you did not request this, ignore this email.`,
      }),
    });
    sent = response.ok;
  } catch {
    /* Never log codes, answers, addresses, or delivery payloads. */
  }
  if (!sent)
    throw new AppError(
      503,
      "Could not send a code. Wait one minute and try again.",
    );
  res.sendStatus(204);
});
management.post("/confirm", async (req, res) => {
  const { code } = z
    .object({ code: z.string().regex(/^[0-9]{6}$/) })
    .parse(req.body);
  if (!(await action(req, "confirm", { digest: digest(req, code) })).ok)
    throw new AppError(
      400,
      "That code is invalid or expired. Request a new code if needed.",
    );
  res.sendStatus(204);
});
management.put("/", async (req, res) => {
  const body = z
    .object({ questions: selectionsSchema, answers: answersSchema })
    .parse(req.body);
  await action(req, "save", {
    questions: body.questions,
    answers: await Promise.all(body.answers.map(hashAnswer)),
  });
  res.sendStatus(204);
});
management.delete("/", async (req, res) => {
  await action(req, "disable");
  res.sendStatus(204);
});
securityQuestions.use(management);
recoveryQuestions.use(limiter, recoveryIdentity);
recoveryQuestions.use("/manage", management);
recoveryQuestions.get("/", async (req, res) => {
  const status=await action(req,"status");
  if(await usesManagedHistory()){
    const history=await historyAction(req,"status");
    const proof=await historyAction(req,"proof",authorizationData(req.get("X-Recovery-Authorization")));
    status.managedHistory={bootstrap:history.version===0,pending:history.pending,stale:history.stale,coverageGap:history.coverageGap,needsReconciliation:history.stale&&!proof.reconciled,paused:(await getHistoryRollout()).mode!=="managed"};
  }
  res.json(status);
});
recoveryQuestions.post("/reconcile",async(req,res)=>{
  const proof=authorizationData(req.get("X-Recovery-Authorization"));
  res.json(await historyAction(req,"reconcile",proof));
});
recoveryQuestions.post("/verify", async (req, res) => {
  const { answers } = z.object({ answers: answersSchema }).parse(req.body);
  const attempt = await action(req, "attempt");
  if (attempt.limited) {
    res.setHeader("Retry-After", "900");
    throw new AppError(
      429,
      "Too many answer attempts. Wait 15 minutes and try again.",
    );
  }
  if (!attempt.enabled) {
    res.sendStatus(204);
    return;
  }
  const matches = await Promise.all(
    answers.map((answer, i) => checkAnswer(answer, attempt.answers[i])),
  );
  if (
    !matches.every(Boolean) ||
    !(await action(req, "prove", { revision: attempt.revision })).ok
  )
    throw new AppError(
      400,
      "Those answers could not be verified. Check all three and try again.",
    );
  res.sendStatus(204);
});
recoveryQuestions.post("/password", async (req, res) => {
  const { password } = z
    .object({
      password: z
        .string()
        .min(8)
        .max(64)
        .refine((v) => Buffer.byteLength(v, "utf8") <= 72)
        .refine(
          validRegistrationPassword,
          "Use a longer passphrase or mix letters, numbers, and symbols.",
        ),
    })
    .parse(req.body);
  if(await usesManagedHistory()){
    if (req.auth!.aal !== "aal2") {
      // Ensure recovery questions (or non-TOTP eligibility) were proved before allowing aal1 reset.
      const ticket = randomBytes(32).toString("hex");
      await action(req, "ticket", {
        digest: createHash("md5").update(ticket).digest("hex"),
      });
    }
    await managedPasswordUpdate(req,{password,authorization:req.get("X-Recovery-Authorization")},"reset");
    res.sendStatus(204);return;
  }
  const ticket = randomBytes(32).toString("hex");
  await action(req, "ticket", {
    digest: createHash("md5").update(ticket).digest("hex"),
  });
  const service = createServiceClient()!;
  // Only the trusted backend can supply app_metadata; the deferred DB trigger
  // consumes this ticket and removes the marker before the transaction commits.
  const { error } = await service.auth.admin.updateUserById(req.auth!.user.id, {
    password,
    app_metadata: { bantai_sq_ticket: ticket },
  });
  if (error)
    throw new AppError(
      400,
      "Could not update your password. Check its requirements and verify your recovery answers again.",
    );
  res.sendStatus(204);
});
