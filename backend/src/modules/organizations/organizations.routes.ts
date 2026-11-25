import { createUserClient } from "../../config/supabase";
import { Router } from "express";
import { z } from "zod";
import { createRateLimiter } from "../../middleware/rateLimit";
import { isSafeImageInput } from "../../utils/urlValidation";
import {
  createOrganization,
  createReportingPeriod,
  createSpace,
  deleteSpace,
  findMembership,
  hasActiveMembership,
  joinOrganization,
  listMemberships,
  listOrganizationMembers,
  listReportingPeriods,
  listSpaces,
  updateMemberRole,
  updateOrganizationDetails,
  updateOrganizationRegionalSettings,
  updateOrganizationLogo,
  updateOrganizationCover,
  isValidIanaTimeZone,
  regenerateOrganizationInviteCode,
  updateSpace,
  checkOrgDeletability,
  transferOrgOwnership,
  deleteOrganization,
} from "./organizations.repository";
import collectionsRouter from "../collections/collections.routes";
import directoryRouter from "./directory.routes";
import financesRouter from "../finances/finances.routes";
import onboardingRouter from "./onboarding.routes";
import { recordOrgDetailsReviewedBestEffort } from "./onboarding.repository";

const routes = Router();
routes.get("/:orgId/my-profile",async(req,res)=>{
  const org=z.uuid().parse(req.params.orgId);
  const client=createUserClient(req.auth!.accessToken);
  const {data,error}=await client.from("organization_members").select("id,role,display_name,organization_id")
    .eq("organization_id",org).eq("profile_id",req.auth!.user.id).eq("status","active").maybeSingle();
  if(error||!data){res.status(403).json({message:"An active membership is required."});return;}
  res.setHeader("Cache-Control","no-store");res.json(data);
});
routes.patch("/:orgId/my-profile",async(req,res)=>{
  const org=z.uuid().parse(req.params.orgId);
  const {displayName}=z.object({displayName:z.string().trim().max(80).refine(v=>!/[\p{Cc}<>]/u.test(v)).nullable()}).strict().parse(req.body);
  const {data,error}=await createUserClient(req.auth!.accessToken).rpc("set_my_organization_display_name",{p_org:org,p_name:displayName});
  if(error){
    const isDomainCode = typeof error.code === "string" && error.code.startsWith("PT");
    const status = error.code === "PT403" ? 403 : isDomainCode ? 400 : 503;
    res.status(status).json({message:isDomainCode ? error.message : "Could not update your workspace display name."});
    return;
  }
  res.setHeader("Cache-Control","no-store");res.json(data);
});

const organizationType = z.enum(["student", "workplace", "club", "nonprofit", "other"]);
const createOrgSchema = z.object({
  organizationType,
  requestId: z.string().uuid(),
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(150, "Name cannot exceed 150 characters."),
  currency: z.string().trim().toUpperCase().refine(code=>["PHP","USD","EUR","GBP","JPY","CAD","AUD","SGD"].includes(code),"Choose a supported currency.").optional().default("PHP"),
  timeZone: z.string().trim().min(1).max(100).refine(isValidIanaTimeZone, "Choose a valid IANA time zone.").optional(),
});

const joinOrgSchema = z.object({
  code: z.string().trim().min(4, "Invitation code is too short.").max(32, "Invitation code is too long."),
});

const createPeriodSchema = z.object({
  name: z.string().trim().min(2, "Period name must be at least 2 characters.").max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD."),
  isDefault: z.boolean().optional().default(false),
});

const createSpaceSchema = z.object({
  name: z.string().trim().min(2, "Space name must be at least 2 characters.").max(100),
  description: z.string().trim().max(500).optional(),
});

const updateSpaceSchema = z.object({
  name: z.string().trim().min(2, "Space name must be at least 2 characters.").max(100),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(["owner", "organization_admin", "treasurer", "auditor", "member"]),
});

const transferOwnershipSchema = z.object({
  targetMemberId: z.string().uuid("Invalid member ID."),
  currentOwnerRole: z.enum(["owner", "organization_admin", "member"]).optional().default("organization_admin"),
});

const deleteOrgSchema = z.object({
  confirmName: z.string().trim().min(1, "Please provide the confirmation organization name."),
});

routes.get("/", async (req, res, next) => {
  try {
    const auth = req.auth!;
    res.json({ memberships: await listMemberships(auth.accessToken, auth.user.id) });
  } catch (err) {
    next(err);
  }
});

const createOrgLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyPrefix: "org-create",
  message: "Too many organization creation attempts. Please wait a few minutes.",
});

const joinOrgLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyPrefix: "org-join",
  message: "Too many join attempts. Please wait a few minutes before trying again.",
});

routes.post("/", createOrgLimiter, async (req, res, next) => {
  try {
    const auth = req.auth!;
    const input = createOrgSchema.parse(req.body);
    const organization = await createOrganization(auth.accessToken, input.name, input.currency, input.organizationType, input.requestId, input.timeZone);
    res.status(201).json({ organization });
  } catch (err) {
    next(err);
  }
});

routes.post("/join", joinOrgLimiter, async (req, res, next) => {
  try {
    const auth = req.auth!;
    const input = joinOrgSchema.parse(req.body);
    const organization = await joinOrganization(auth.accessToken, input.code);
    res.status(200).json({ organization });
  } catch (err) {
    next(err);
  }
});

routes.get("/:organizationId/expense-policy", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const client = createUserClient(req.auth!.accessToken);
    const { data, error } = await client.from("organizations").select("expense_approval_policy,treasurer_expense_approval,expense_policy_version").eq("id", id).single();
    if (error) { res.status(403).json({ message: "Approval policy unavailable." }); return; }
    res.json({ policy: data });
  } catch (err) { next(err); }
});
routes.patch("/:organizationId/expense-policy", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const input = z.object({ policy: z.enum(["standard", "owner_admin_self", "strict"]), treasurerApproval: z.boolean() }).strict().parse(req.body);
    const { data, error } = await createUserClient(req.auth!.accessToken).rpc("set_expense_approval_policy", { p_org_id: id, p_policy: input.policy, p_treasurer: input.treasurerApproval });
    if (error) { res.status(403).json({ message: "Approval policy update unavailable." }); return; }
    res.json({ policy: data });
  } catch (err) { next(err); }
});
routes.patch("/:organizationId/members/:memberId/expense-submission", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const memberId = z.uuid().parse(req.params.memberId);
    const input = z.object({ allowed: z.boolean() }).strict().parse(req.body);
    const { error } = await createUserClient(req.auth!.accessToken).rpc("set_member_expense_submission", { p_org_id: id, p_member_id: memberId, p_allowed: input.allowed });
    if (error) { res.status(403).json({ message: "Expense submission setting update unavailable." }); return; }
    res.json({ success: true });
  } catch (err) { next(err); }
});

routes.get("/:organizationId", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const membership = await findMembership(auth.accessToken, auth.user.id, id, { includeBranding: true });
    if (!membership) {
      res.status(404).json({ message: "Organization not found." });
      return;
    }
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

routes.patch("/:organizationId", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const membership = await findMembership(auth.accessToken, auth.user.id, id);
    if (!membership || (membership.role !== "owner" && membership.role !== "organization_admin")) {
      res.status(403).json({ message: "Only workspace owners and administrators can update organization settings." });
      return;
    }
    const input = z.object({
      name: z.string().trim().min(1, "Name must be at least 1 character.").max(150, "Name cannot exceed 150 characters."),
      currency: z.string().trim().length(3, "Currency must be a 3-letter code.").toUpperCase().optional(),
      description: z.string().trim().max(300).optional(),
    }).parse(req.body);

    const updated = await updateOrganizationDetails(auth.accessToken, id, input);
    await recordOrgDetailsReviewedBestEffort(auth.accessToken, auth.user.id, id);
    res.json({ organization: updated });
  } catch (err) {
    next(err);
  }
});

routes.patch("/:organizationId/regional-settings", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const membership = await findMembership(auth.accessToken, auth.user.id, id);
    if (!membership || (membership.role !== "owner" && membership.role !== "organization_admin")) {
      res.status(403).json({ message: "Only workspace owners and administrators can update regional settings." });
      return;
    }
    const input = z.object({
      currency: z.string().trim().toUpperCase().refine(
        (code) => ["PHP", "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "SGD"].includes(code),
        "Choose a supported currency."
      ).optional(),
      timeZone: z.string().trim().min(1, "Choose a valid IANA time zone.").max(100).refine(
        isValidIanaTimeZone,
        "Choose a valid IANA time zone."
      ).optional(),
    }).refine(
      (data) => data.currency !== undefined || data.timeZone !== undefined,
      "Provide at least one regional setting to update."
    ).parse(req.body);

    const updated = await updateOrganizationRegionalSettings(auth.accessToken, id, input);
    await recordOrgDetailsReviewedBestEffort(auth.accessToken, auth.user.id, id);
    res.json({ organization: updated });
  } catch (err) {
    next(err);
  }
});

routes.post("/:organizationId/regenerate-invite", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const membership = await findMembership(auth.accessToken, auth.user.id, id);
    if (!membership || (membership.role !== "owner" && membership.role !== "organization_admin")) {
      res.status(403).json({ message: "Only workspace owners and administrators can regenerate the invite code." });
      return;
    }
    const result = await regenerateOrganizationInviteCode(auth.accessToken, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

routes.patch("/:organizationId/logo", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const membership = await findMembership(auth.accessToken, auth.user.id, id);
    if (!membership || (membership.role !== "owner" && membership.role !== "organization_admin")) {
      res.status(403).json({ message: "Only workspace owners and administrators can update the organization logo." });
      return;
    }
    const input = z.object({
      logoUrl: z
        .string()
        .max(250000)
        .refine((v) => v === "" || isSafeImageInput(v), "Logo must be a valid https:// URL or PNG/JPEG/WebP image.")
        .nullable()
        .optional(),
    }).parse(req.body);

    const updated = await updateOrganizationLogo(auth.accessToken, id, input.logoUrl ?? null);
    res.json({ organization: updated });
  } catch (err) {
    next(err);
  }
});

routes.patch("/:organizationId/cover", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const membership = await findMembership(auth.accessToken, auth.user.id, id);
    if (!membership || (membership.role !== "owner" && membership.role !== "organization_admin")) {
      res.status(403).json({ message: "Only workspace owners and administrators can update the organization cover." });
      return;
    }
    const input = z.object({
      coverImageUrl: z
        .string()
        .max(500000)
        .refine((v) => v === "" || isSafeImageInput(v), "Cover must be a valid https:// URL or PNG/JPEG/WebP image.")
        .nullable()
        .optional(),
      coverTheme: z.string().trim().max(64).nullable().optional(),
    }).parse(req.body);

    const updated = await updateOrganizationCover(
      auth.accessToken,
      id,
      input.coverImageUrl ?? null,
      input.coverTheme ?? null
    );
    res.json({ organization: updated });
  } catch (err) {
    next(err);
  }
});

routes.get("/:organizationId/members", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    if (!await hasActiveMembership(auth.accessToken, auth.user.id, id)) {
      res.status(404).json({ message: "Organization not found or you are not a member." });
      return;
    }
    const members = await listOrganizationMembers(auth.accessToken, id);
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

routes.patch("/:organizationId/members/:membershipId/role", async (req, res, next) => {
  try {
    const orgId = z.uuid().parse(req.params.organizationId);
    const membershipId = z.uuid().parse(req.params.membershipId);
    const auth = req.auth!;
    const input = updateRoleSchema.parse(req.body);
    const { data: targetRow } = await createUserClient(auth.accessToken)
      .from("organization_members")
      .select("id")
      .eq("id", membershipId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!targetRow) {
      res.status(404).json({ message: "Member not found in this organization." });
      return;
    }
    const updated = await updateMemberRole(auth.accessToken, membershipId, input.role);
    res.json({ member: updated });
  } catch (err) {
    next(err);
  }
});

routes.get("/:organizationId/periods", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const membership = await findMembership(auth.accessToken, auth.user.id, id);
    if (!membership) {
      res.status(404).json({ message: "Organization not found." });
      return;
    }
    const periods = await listReportingPeriods(auth.accessToken, id);
    res.json({ periods });
  } catch (err) {
    next(err);
  }
});

routes.post("/:organizationId/periods", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const input = createPeriodSchema.parse(req.body);
    const period = await createReportingPeriod(
      auth.accessToken,
      id,
      input.name,
      input.startDate,
      input.endDate,
      input.isDefault
    );
    res.status(201).json({ period });
  } catch (err) {
    next(err);
  }
});

routes.get("/:organizationId/spaces", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const membership = await findMembership(auth.accessToken, auth.user.id, id);
    if (!membership) {
      res.status(404).json({ message: "Organization not found." });
      return;
    }
    const spaces = await listSpaces(auth.accessToken, id);
    res.json({ spaces });
  } catch (err) {
    next(err);
  }
});

routes.post("/:organizationId/spaces", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const input = createSpaceSchema.parse(req.body);
    const space = await createSpace(auth.accessToken, id, input.name, input.description);
    res.status(201).json({ space });
  } catch (err) {
    next(err);
  }
});

routes.patch("/:organizationId/spaces/:spaceId", async (req, res, next) => {
  try {
    const orgId = z.uuid().parse(req.params.organizationId);
    const spaceId = z.uuid().parse(req.params.spaceId);
    const auth = req.auth!;
    const input = updateSpaceSchema.parse(req.body);
    const space = await updateSpace(auth.accessToken, orgId, spaceId, input);
    res.json({ space });
  } catch (err) {
    next(err);
  }
});

routes.delete("/:organizationId/spaces/:spaceId", async (req, res, next) => {
  try {
    const orgId = z.uuid().parse(req.params.organizationId);
    const spaceId = z.uuid().parse(req.params.spaceId);
    const auth = req.auth!;
    const result = await deleteSpace(auth.accessToken, orgId, spaceId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

routes.get("/:organizationId/deletability", async (req, res, next) => {
  try {
    const orgId = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const deletability = await checkOrgDeletability(auth.accessToken, orgId);
    res.json({ deletability });
  } catch (err) {
    next(err);
  }
});

routes.post("/:organizationId/transfer-ownership", async (req, res, next) => {
  try {
    const orgId = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const input = transferOwnershipSchema.parse(req.body);
    const result = await transferOrgOwnership(
      auth.accessToken,
      orgId,
      input.targetMemberId,
      input.currentOwnerRole
    );
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

routes.delete("/:organizationId", async (req, res, next) => {
  try {
    const orgId = z.uuid().parse(req.params.organizationId);
    const auth = req.auth!;
    const input = deleteOrgSchema.parse(req.body);

    const membership = await findMembership(auth.accessToken, auth.user.id, orgId);
    const org: any = Array.isArray(membership?.organizations)
      ? membership.organizations[0]
      : membership?.organizations;

    if (!membership || !org) {
      res.status(404).json({ message: "Organization not found." });
      return;
    }

    if (membership.role !== "owner") {
      res.status(403).json({ message: "Only the organization owner can close this organization." });
      return;
    }

    if (org.name?.trim().toLowerCase() !== input.confirmName.trim().toLowerCase()) {
      res.status(400).json({ message: `Confirmation name does not match '${org.name}'.` });
      return;
    }

    const result = await deleteOrganization(auth.accessToken, orgId);
    res.json({ success: true, message: "Organization closed. Records are retained for review.", result });
  } catch (err) {
    next(err);
  }
});

routes.get("/:organizationId/type", async (req, res, next) => {
  try {
    const orgId = z.string().uuid().parse(req.params.organizationId);
    const result = await createUserClient(req.auth!.accessToken).from("organizations")
      .select("organization_type").eq("id", orgId).maybeSingle();
    if (result.error) {
      res.status(result.error.code === "42501" ? 403 : 503).json({ message: "Organization type is temporarily unavailable." });
      return;
    }
    if (!result.data) {
      res.status(404).json({ message: "Organization not found." });
      return;
    }
    res.json({ organizationType: result.data.organization_type });
  } catch (error) { next(error); }
});
routes.put("/:organizationId/type", async (req, res, next) => {
  try {
    const orgId = z.string().uuid().parse(req.params.organizationId);
    const input = z.object({
      organizationType,
      syncDirectoryFields: z.boolean().optional(),
    }).parse(req.body);
    const result = await createUserClient(req.auth!.accessToken).rpc("set_organization_type", {
      target_org: orgId,
      org_type: input.organizationType,
      sync_directory_fields: input.syncDirectoryFields ?? false,
    });
    if (result.error) { res.status(result.error.code === "42501" ? 403 : 400).json({ message: "Could not update organization type." }); return; }
    res.sendStatus(204);
  } catch (error) { next(error); }
});

const approvalPresetInput = z.object({
  preset: z.enum(["simple", "balanced", "strict"]),
  expectedVersion: z.number().int().positive(),
});

routes.get("/:organizationId/approval-preset", async (req, res, next) => {
  try {
    const org = z.string().uuid().parse(req.params.organizationId);
    const { data, error } = await createUserClient(req.auth!.accessToken).from("organizations")
      .select("approval_preset, approval_preset_version").eq("id", org).maybeSingle();
    if (error || !data) { res.status(error ? 503 : 404).json({ message: "Approval policy is unavailable." }); return; }
    res.json(data);
  } catch (error) { next(error); }
});

routes.put("/:organizationId/approval-preset", async (req, res, next) => {
  try {
    const org = z.string().uuid().parse(req.params.organizationId);
    const input = approvalPresetInput.parse(req.body);
    const { data, error } = await createUserClient(req.auth!.accessToken).rpc("set_approval_preset", {
      org, preset: input.preset, expected_version: input.expectedVersion,
    });
    if (error) {
      res.status(error.code === "42501" ? 403 : error.code === "40001" ? 409 : 503).json({
        message: error.code === "42501" ? "Only the organization owner can update the policy."
          : error.code === "40001" ? "The policy changed. Refresh and try again." : "Could not save the approval policy.",
      });
      return;
    }
    res.json(data);
  } catch (error) { next(error); }
});

routes.use(collectionsRouter);
routes.use(directoryRouter);
routes.use(financesRouter);
routes.use(onboardingRouter);

export default routes;
