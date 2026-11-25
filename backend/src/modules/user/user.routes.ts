import express, { Router } from "express";
import { z } from "zod";
import { createRateLimiter } from "../../middleware/rateLimit";
import { isSafeImageInput } from "../../utils/urlValidation";
import {
  getUserProfile,
  updateUserProfile,
  getUserPreferences,
  updateUserPreferences,
  completeAccountOnboarding,
  leaveOrganization,
  deletePersonalAccount,
} from "./user.repository";
import { listUserObligations } from "../collections/collections.repository";
import { createUserClient } from "../../config/supabase";
import { personalIdentitySchema } from "./personalIdentity";

const routes = Router();

// The shared authentication middleware records activity only on this route.
routes.post("/session/activity", (_req, res) => { res.sendStatus(204); });
routes.get("/session", (_req, res) => { res.sendStatus(204); });

const updateProfileSchema = z.object({
  avatarUrl: z
    .string()
    .trim()
    .max(3000000, "Avatar payload exceeds maximum size.")
    .refine((v) => v === "" || isSafeImageInput(v), "Avatar must be a valid https:// URL or PNG/JPEG/WebP image.")
    .nullable()
    .optional(),
}).strict();

const themeSchema = z.enum(["light", "dark", "system"]);
const updatePreferencesSchema = z.object({
  theme: themeSchema.optional(),
  reducedMotion: z.boolean().optional(),
  defaultOrganizationId: z.string().uuid("Invalid organization ID.").nullable().optional(),
  notifications: z.record(z.string(), z.boolean()).optional(),
});

// GET /user - Retrieve authenticated user profile with providers and preferences
routes.get("/", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const user = auth.user;
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;

    const profile = await getUserProfile(auth.accessToken, user.id);

    const {data:identity,error:identityError}=await createUserClient(auth.accessToken).rpc("get_my_personal_identity");
    if(identityError)throw new Error("Identity lookup unavailable");
    const displayName=identity?.username?`@${identity.username}`:null;

    const avatarUrl =
      profile?.avatar_url ||
      (metadata.avatar_url as string) ||
      (metadata.picture as string) ||
      null;

    const identityProviders = Array.isArray(user.identities)
      ? (user.identities
          .map((i: { provider?: string }) => i.provider)
          .filter(Boolean) as string[])
      : [];
    const appProviders = Array.isArray(user.app_metadata?.providers)
      ? (user.app_metadata.providers as string[])
      : user.app_metadata?.provider
      ? [user.app_metadata.provider as string]
      : [];
    const mergedProviders = Array.from(new Set([...identityProviders, ...appProviders]));
    const providers = mergedProviders.length > 0 ? mergedProviders : ["email"];

    res.setHeader("Cache-Control", "no-store");
    res.json({
      id: user.id,
      email: user.email,
      displayName,
      username:identity?.username??null,
      personalIdentity:identity,
      onboardingStep: profile?.onboarding_step && !identity?.complete ? "name" : profile?.onboarding_step ?? null,
      avatarUrl,
      platformRole: (profile as { role?: string } | null)?.role ?? "user",
      providers,
      verified: Boolean(user.email_confirmed_at),
      createdAt: user.created_at,
    });
  } catch (err) {
    next(err);
  }
});

function safeIdentityErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
  if (typeof error.code === "string" && error.code.startsWith("PT") && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

const profileUpdateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: "user_profile_update",
  message: "Too many profile updates. Please wait a moment and try again.",
});

const deleteAccountLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: "user_delete_account",
  failClosed: true,
  message: "Too many account deletion requests. Please wait 15 minutes and try again.",
});

routes.put("/username",async(req,res)=>{
  const { username } = z.object({username:z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{5,19}$/)}).parse(req.body);
  const {data,error}=await createUserClient(req.auth!.accessToken).rpc("set_my_username",{p_username:username});
  if(error){
    const status = error.code === "PT409" ? 409 : error.code?.startsWith("PT") ? 400 : 503;
    res.status(status).json({message:safeIdentityErrorMessage(error, "Could not update your username. Try again.")});
    return;
  }
  res.setHeader("Cache-Control","no-store");res.json({username:data});
});
routes.put("/personal-information",async(req,res)=>{
  const identity=personalIdentitySchema.parse(req.body);
  const {data,error}=await createUserClient(req.auth!.accessToken).rpc("set_my_personal_identity",{
    p_first:identity.firstName,p_middle:identity.middleName,p_last:identity.lastName,p_birth:identity.birthdate,p_username:identity.username,
  });
  if(error){
    const status = error.code === "PT409" ? 409 : error.code === "PT403" ? 403 : error.code?.startsWith("PT") ? 400 : 503;
    res.status(status).json({message:safeIdentityErrorMessage(error, "Could not save your personal information. Try again.")});
    return;
  }
  res.setHeader("Cache-Control","no-store");res.json(data);
});

routes.post("/onboarding/complete", async (req, res, next) => {
  try {
    const { theme } = z.object({ theme: themeSchema }).parse(req.body);
    const savedTheme = await completeAccountOnboarding(req.auth!.accessToken, theme);
    res.setHeader("Cache-Control", "no-store");
    res.json({ theme: savedTheme });
  } catch (error) {
    next(error);
  }
});

// PATCH /user/profile - Update display name and avatar
routes.patch("/profile", profileUpdateLimiter, express.json({ limit: "5mb" }), async (req, res, next) => {
  try {
    const auth = req.auth!;
    const input = updateProfileSchema.parse(req.body);
    const profile = await updateUserProfile(auth.accessToken, auth.user.id, input);

    res.setHeader("Cache-Control", "no-store");
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

// GET /user/preferences - Retrieve user preferences
routes.get("/preferences", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const preferences = await getUserPreferences(auth.accessToken, auth.user.id);

    res.setHeader("Cache-Control", "no-store");
    res.json({ preferences });
  } catch (err) {
    next(err);
  }
});

// PATCH /user/preferences - Update user preferences
routes.patch("/preferences", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const input = updatePreferencesSchema.parse(req.body);
    const preferences = await updateUserPreferences(auth.accessToken, auth.user.id, input);

    res.setHeader("Cache-Control", "no-store");
    res.json({ preferences });
  } catch (err) {
    next(err);
  }
});

// GET /user/obligations - Consolidated user dues and obligations
routes.get("/obligations", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const obligations = await listUserObligations(auth.accessToken, auth.user.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ obligations });
  } catch (err) {
    next(err);
  }
});

// POST /user/organizations/:orgId/leave - Leave an organization
routes.post("/organizations/:orgId/leave", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const orgId = z.string().uuid("Invalid organization ID.").parse(req.params.orgId);
    const result = await leaveOrganization(auth.accessToken, orgId);

    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

// POST /user/delete-account - Anonymize and delete personal account
routes.post("/delete-account", deleteAccountLimiter, async (req, res, next) => {
  try {
    const auth = req.auth!;
    const result = await deletePersonalAccount(auth.accessToken);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      message: "Account deactivated and personal details anonymized.",
      result,
    });
  } catch (err) {
    next(err);
  }
});

export default routes;
