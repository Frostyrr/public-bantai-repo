import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request } from "express";
import { env } from "../../constants/env";
import { createServiceClient } from "../../config/supabase";
import AppError from "../../utils/AppError";
import { hashPassword, rejectReusedPassword } from "./passwordVerifier";
export class PasswordHistoryError extends AppError {
  constructor(status: 400 | 401 | 403 | 409 | 503, message: string, public publicCode: string) { super(status, message); }
}
export const historyEnabled = () => env.PASSWORD_HISTORY_ENABLED === "true";
export const PASSWORD_HISTORY_BACKEND_VERSION = "password-history-v2";
export async function getHistoryRollout() {
  const service=createServiceClient();
  if(!service)throw new PasswordHistoryError(503,"Password management is temporarily unavailable.","password_history_unavailable");
  const {data,error}=await service.rpc("bantai_password_history_rollout");
  if(error||data?.protocol!==2||!["legacy","managed","frozen"].includes(data?.mode))
    throw new PasswordHistoryError(503,"Password management is temporarily unavailable.","password_history_unavailable");
  return data as {protocol:2;mode:"legacy"|"managed"|"frozen";epoch?:number;databaseGate?:"disabled"|"managed"|"frozen"};
}
export async function usesManagedHistory(){return historyEnabled()||(await getHistoryRollout()).mode!=="legacy";}
export function requireHistory() {
  if (!historyEnabled())
    throw new PasswordHistoryError(409, "Managed password history is disabled.", "password_history_disabled");
  if (env.PASSWORD_HISTORY_NATIVE_CURRENT_PASSWORD_REQUIRED !== "true")
    throw new PasswordHistoryError(503, "Password history is not configured for activation.", "password_history_unavailable");
}
export const sha = (value: string) => createHash("sha256").update(value).digest("hex");
// Digest of a random 256-bit operation secret, never a password verifier.
export const operationDigest = (value: string) => createHash("md5").update(value).digest("hex");
export function newAuthorization() {
  const id = randomUUID();
  const token = `${id}.${randomBytes(32).toString("hex")}`;
  return { id, token, digest: sha(token) };
}
export function authorizationData(token: unknown) {
  if (typeof token !== "string" || !/^[-a-f0-9]{36}\.[a-f0-9]{64}$/.test(token))
    throw new PasswordHistoryError(403, "Verify a fresh code for this password operation.", "password_proof_required");
  return { authorizationId: token.split(".")[0], authorizationDigest: sha(token) };
}
export async function historyAction(req: Request, action: string, data: object = {}) {
  // Verification and reconciliation survive application-flag rollback.
  await getHistoryRollout();
  if(action==="stage")requireHistory();
  const service = createServiceClient();
  if (!service || !req.auth?.sessionId)
    throw new PasswordHistoryError(503, "Password verification is unavailable.", "password_history_unavailable");
  const { data: result, error } = await service.rpc("bantai_password_history", { p_user: req.auth.user.id, p_session: req.auth.sessionId, p_aal: req.auth.aal ?? "aal1", p_action: action, p_data: data });
  if (error)
    throw new PasswordHistoryError(409, "Could not verify password history or authorization. If a change is unfinished, use verified recovery to reconcile it.", "password_history_verification_failed");
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new PasswordHistoryError(503, "Password history is unavailable.", "password_history_unavailable");
  return result;
}
export async function requireRecoveryProof(req: Request) {
  if (!req.get("X-Recovery-Authorization") && !await usesManagedHistory())
    return;
  const proof = authorizationData(req.get("X-Recovery-Authorization"));
  if ((await historyAction(req, "proof", proof)).purpose !== "reset")
    throw new PasswordHistoryError(403, "Verify a recovery code for this password reset.", "password_proof_required");
}
export async function managedPasswordUpdate(req: Request, input: {
  password: string;
  currentPassword?: string;
  nonce?: string;
  authorization: unknown;
}, purpose: "change" | "reset") {
  const proof = authorizationData(input.authorization);
  const validation = await historyAction(req, "proof", proof);
  if (validation.purpose !== purpose)
    throw new PasswordHistoryError(403, "This verification does not authorize that password operation.", "password_proof_required");
  const snapshot = await historyAction(req, "snapshot", proof);
  if (snapshot.stale && purpose !== "reset")
    throw new PasswordHistoryError(409, "Your password changed outside Bantai. Use verified password recovery to reconcile it; your known password history will be retained.", "password_history_stale");
  let candidate: string, seed: string | undefined;
  try {
    if (await rejectReusedPassword(input.password, snapshot.verifiers, snapshot.version, snapshot.tracked))
      throw new PasswordHistoryError(400, "Choose a password different from your current and three previously used passwords.", "password_reused");
    candidate = await hashPassword(input.password);
    if (snapshot.version === 0 && purpose === "change" && input.currentPassword)
      seed = await hashPassword(input.currentPassword);
  }
  catch (error) {
    if (error instanceof PasswordHistoryError)
      throw error;
    throw new PasswordHistoryError(503, "Password history could not be checked. Your password was not submitted.", "password_history_unavailable");
  }
  const operationId = randomUUID(), marker = randomBytes(32).toString("hex");
  const context = { ...proof, operationId };
  try {
    const staged = await historyAction(req, "stage", { ...context, operationDigest: operationDigest(marker), version: snapshot.version, epoch: snapshot.epoch, candidate, seed, questionTicket: randomBytes(32).toString("hex") });
    if(staged.ok !== true)throw new PasswordHistoryError(503,"Password operation could not be staged.","password_history_unavailable");
  }
  catch (error) {
    // A lost stage response must not cause an untracked credential write.
    await historyAction(req, "cancel", context).catch(() => undefined);
    throw error;
  }
  let nativeCode = "password_update_failed";
  try {
    if (purpose === "reset" && req.auth!.aal !== "aal2") {
      const service = createServiceClient();
      if (!service) {
        nativeCode = "password_history_unavailable";
      } else {
        const { error } = await service.auth.admin.updateUserById(req.auth!.user.id, {
          password: input.password,
          user_metadata: {
            ...(req.auth!.user.user_metadata ?? {}),
            bantai_password_operation: marker,
          },
        });
        if (error) {
          nativeCode = (error as { code?: string }).code ?? "password_update_failed";
        }
      }
    } else {
      const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
        method: "PUT", signal: AbortSignal.timeout(15000),
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${req.auth!.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: input.password, current_password: input.currentPassword, nonce: input.nonce, data: { bantai_password_operation: marker } }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = typeof body?.error_code === "string" ? body.error_code : body?.code;
        if (["reauthentication_needed", "reauthentication_not_valid", "same_password", "current_password_mismatch", "current_password_required", "weak_password", "insufficient_aal"].includes(code))
          nativeCode = code;
      }
    }
    // Never return or log the native response (it can contain transient metadata).
  }
  catch { /* A client timeout is not proof of failure. Fence before permitting retry. */ }
  let outcome;
  try {
    outcome = await historyAction(req, "outcome", context);
  }
  catch {
    throw new PasswordHistoryError(503, "The password change needs reconciliation. Start verified recovery and resolve the unfinished change before retrying.", "password_change_uncertain");
  }
  if (outcome.status === "committed")
    return;
  try {
    outcome = await historyAction(req, "cancel", context);
    if(!["committed","cancelled","none"].includes(outcome.status))throw new Error("Unknown cancellation outcome");
  }
  catch {
    throw new PasswordHistoryError(503, "The password change needs reconciliation. Start verified recovery and resolve the unfinished change before retrying.", "password_change_uncertain");
  }
  if (outcome.status === "committed")
    return;
  if (nativeCode === "same_password")
    throw new PasswordHistoryError(400, "Choose a password different from your current and three previously used passwords.", "password_reused");
  if (nativeCode === "reauthentication_needed" || nativeCode === "reauthentication_not_valid")
    throw new PasswordHistoryError(400, "Enter a fresh Supabase password-change code as well as your verified password-change authorization.", nativeCode);
  if (nativeCode === "current_password_mismatch" || nativeCode === "current_password_required")
    throw new PasswordHistoryError(400, "Check your current password and try again.", nativeCode);
  throw new PasswordHistoryError(400, "The password change did not commit. Check the password requirements and verification, then try again.", nativeCode);
}
