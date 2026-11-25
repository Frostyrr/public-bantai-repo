import { exportCollection } from "./collectionExport";
import { Router } from "express";
import { z } from "zod";
import {
  assignDirectoryObligations,
  previewOrAssignDuesScope,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  listObligations,
  collectionMemberRpc,
  listPayments,
  recordPayment,
  reversePayment,
  updateCollection,
} from "./collections.repository";

const router = Router({ mergeParams: true });

const orgIdParam = z.string().uuid("Invalid Organization ID");
const collectionIdParam = z.string().uuid("Invalid Collection ID");
const paymentIdParam = z.string().uuid("Invalid Payment ID");

router.get("/:organizationId/archives", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const search = z.string().trim().max(150).parse(req.query.search ?? "");
    const page = z.coerce.number().int().min(0).max(100000).parse(req.query.page ?? 0);
    const rows = await collectionMemberRpc(req.auth!.accessToken, "list_collection_archives", { org, search, page });
    res.json({ rows: rows.slice(0, 20), hasMore: rows.length > 20 });
  } catch (error) { next(error); }
});

router.post("/:organizationId/collections/:collectionId/archive", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const collection = collectionIdParam.parse(req.params.collectionId);
    const { archive } = z.object({ archive: z.boolean() }).parse(req.body);
    const status = await collectionMemberRpc(req.auth!.accessToken, "set_collection_archived", { org, collection, archive });
    res.json({ status });
  } catch (error) { next(error); }
});

const savedScope = z.object({
  scope: z.enum(["all", "groups", "selected"]),
  groupIds: z.array(z.string().uuid()).max(100).default([]),
  memberIds: z.array(z.string().uuid()).max(500).default([]),
});
const assessmentAmount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const assessmentDraft = savedScope.extend({amount:assessmentAmount});

const createCollectionSchema = z.object({
  memberScope: savedScope.optional(),
  assessment: z.object({amount:assessmentAmount,automatic:z.boolean(),token:z.string().length(32),requestId:z.string().uuid()}).optional(),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(150),
  description: z.string().trim().max(1000).optional(),
  spaceId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  targetCentavos: z.number().int().nonnegative().optional().default(0),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD.").optional(),
  defaultObligationCentavos: z.number().int().nonnegative().optional().default(0),
  assignAll: z.boolean().optional().default(false),
});

const updateCollectionSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(150),
  description: z.string().trim().max(1000).optional(),
  spaceId: z.string().uuid().optional(),
  targetCentavos: z.number().int().nonnegative().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD.").optional(),
  status: z.enum(["active", "closed", "archived"]).optional(),
});

const recordPaymentSchema = z.object({
  obligationId: z.string().uuid("Invalid Obligation ID"),
  amountCentavos: z.number().int().positive("Payment amount must be greater than zero"),
  paymentMethod: z.enum(["cash", "bank_transfer", "gcash", "maya", "other"]),
  referenceNumber: z.string().trim().max(100).optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

const reversePaymentSchema = z.object({
  reason: z.string().trim().min(3, "Reversal reason must be at least 3 characters.").max(500),
});

// List Collections for Organization
router.get("/:organizationId/collections", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const filters = {
      spaceId: typeof req.query.spaceId === "string" ? req.query.spaceId : undefined,
      periodId: typeof req.query.periodId === "string" ? req.query.periodId : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
    };
    const collections = await listCollections(req.auth!.accessToken, orgId, filters);
    res.json({ collections });
  } catch (err) {
    next(err);
  }
});

router.post("/:organizationId/collections/creation-review", async (req,res,next) => {
  try {
    const draft=assessmentDraft.parse(req.body);
    res.json(await collectionMemberRpc(req.auth!.accessToken,"collection_creation_review",{
      org:orgIdParam.parse(req.params.organizationId),scope:draft.scope,groups:draft.groupIds,members:draft.memberIds,amount:draft.amount,
    }));
  } catch(error) {next(error);}
});

for(const method of ["get","post"] as const) {
  router[method]("/:organizationId/collections/:collectionId/assessment-policy",async(req,res,next)=>{
    try {
      const input=method==="post"?z.object({amount:assessmentAmount.optional(),automatic:z.boolean().optional(),retry:z.boolean().optional()}).parse(req.body):{};
      res.json(await collectionMemberRpc(req.auth!.accessToken,"collection_assessment_policy",{
        org:orgIdParam.parse(req.params.organizationId),collection:collectionIdParam.parse(req.params.collectionId),...input,
      }));
    } catch(error) {next(error);}
  });
}

// Create Collection
router.post("/:organizationId/collections", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const input = createCollectionSchema.parse(req.body);
    if (input.assessment && input.memberScope) {
      const result = await collectionMemberRpc(req.auth!.accessToken,"create_assessed_collection",{
        org:orgId,title:input.title,description:input.description??null,space:input.spaceId??null,
        period:input.periodId??null,target:input.targetCentavos,due:input.dueDate??null,
        scope:input.memberScope.scope,groups:input.memberScope.groupIds,members:input.memberScope.memberIds,
        amount:input.assessment.amount,automatic:input.assessment.automatic,review_token:input.assessment.token,request_id:input.assessment.requestId,
      });
      if(result.changed) {res.status(409).json({message:"Eligible members changed. Review the updated assessment.",preview:result});return;}
      res.status(201).json({collection:result});return;
    }
    if (input.assessment) {res.status(400).json({message:"Choose a member scope."});return;}
    const collection = await createCollection(req.auth!.accessToken, orgId, input);
    res.status(201).json({ collection });
  } catch (err) {
    next(err);
  }
});

// Get Collection Details
router.get("/:organizationId/collections/:collectionId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const collId = collectionIdParam.parse(req.params.collectionId);
    const collection = await getCollection(req.auth!.accessToken, orgId, collId);
    res.json({ collection });
  } catch (err) {
    next(err);
  }
});

// Update Collection
router.patch("/:organizationId/collections/:collectionId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const collId = collectionIdParam.parse(req.params.collectionId);
    const input = updateCollectionSchema.parse(req.body);
    const collection = await updateCollection(req.auth!.accessToken, orgId, collId, input);
    res.json({ collection });
  } catch (err) {
    next(err);
  }
});

// Delete Collection
router.delete("/:organizationId/collections/:collectionId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const collId = collectionIdParam.parse(req.params.collectionId);
    const { confirmation } = z.object({ confirmation: z.string().min(1).max(150) }).parse(req.body);
    const result = await deleteCollection(req.auth!.accessToken, orgId, collId, confirmation);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/:organizationId/collections/group-eligible-count",async(req,res,next)=>{
  try {
    const {groupIds}=savedScope.pick({groupIds:true}).parse(req.body);
    const count=await collectionMemberRpc(req.auth!.accessToken,"collection_group_eligible_count",{
      org:orgIdParam.parse(req.params.organizationId),groups:groupIds,
    });
    res.json({count});
  } catch(error) { next(error); }
});
const rosterAmount = z.string().regex(/^\d{1,16}$/).transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).optional();
const rosterAmountFilters = z.object({
  assessedMin: rosterAmount, assessedMax: rosterAmount,
  paidMin: rosterAmount, paidMax: rosterAmount,
  balanceMin: rosterAmount, balanceMax: rosterAmount,
  noAssessment: z.literal("true").transform(() => true).optional(),
}).refine(filters => [
  [filters.assessedMin, filters.assessedMax],
  [filters.paidMin, filters.paidMax],
  [filters.balanceMin, filters.balanceMax],
].every(([min, max]) => min === undefined || max === undefined || min <= max), {
  message: "Minimum amounts must be less than or equal to maximum amounts.",
});
const rosterRpcAmounts = (query: unknown) => {
  const amounts = rosterAmountFilters.parse(query);
  return Object.values(amounts).some(value => value !== undefined) ? { amounts } : {};
};

router.get("/:organizationId/collections/:collectionId/export", async (req, res, next) => {
  try {
    const options = z.object({
      mode: z.enum(["detailed", "summary"]).default("detailed"),
      status: z.enum(["all","assessed","not_assessed","pending","partially_paid","paid","waived"]).default("all"),
      q: z.string().trim().max(100).default(""),
      obligationId: z.string().uuid().optional(),
    }).parse(req.query);
    await exportCollection(res, req.auth!.accessToken, orgIdParam.parse(req.params.organizationId),
      collectionIdParam.parse(req.params.collectionId), { ...options, ...rosterRpcAmounts(req.query) });
  } catch (error) { next(error); }
});
router.get("/:organizationId/collections/:collectionId/members", async (req,res,next) => {
  try {
    const params = z.object({ page:z.coerce.number().int().min(0).max(10000).default(0), q:z.string().trim().max(100).default(""),
      status:z.enum(["all","assessed","not_assessed","pending","partially_paid","paid","waived"]).default("all"), obligationId:z.string().uuid().optional() }).parse(req.query);
    const result = await collectionMemberRpc(req.auth!.accessToken,"collection_members_page",{
      org:orgIdParam.parse(req.params.organizationId), collection:collectionIdParam.parse(req.params.collectionId),
      page_offset:params.page*25,search_text:params.q,filter_status:params.status,target_obligation:params.obligationId??null,
      ...rosterRpcAmounts(req.query),
    });
    res.json({...result,rows:result.rows.slice(0,25),hasMore:result.rows.length>25});
  } catch(error) { next(error); }
});
for (const method of ["get","post"] as const) {
  router[method]("/:organizationId/collections/:collectionId/member-scope", async (req,res,next) => {
    try {
      const input=method==="post"?savedScope.extend({token:z.string().length(32).optional()}).parse(req.body):null;
      const result=await collectionMemberRpc(req.auth!.accessToken,"collection_scope_settings",{
        org:orgIdParam.parse(req.params.organizationId),collection:collectionIdParam.parse(req.params.collectionId),
        ...(input?{scope:input.scope,groups:input.groupIds,members:input.memberIds,review_token:input.token??null}:{}),
      });
      res.status(result.changed?409:200).json(result.changed?{message:"Membership changed. Review the updated scope.",preview:result}:result);
    } catch(error) { next(error); }
  });
}

// List Obligations for Collection
router.get("/:organizationId/collections/:collectionId/obligations", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const collId = collectionIdParam.parse(req.params.collectionId);
    const page = req.query.page === undefined ? undefined : z.object({
      page:z.coerce.number().int().min(0).max(10000), q:z.string().trim().max(100).default(""),
      status:z.enum(["all","pending","partially_paid","paid","waived"]).default("all"), obligationId:z.string().uuid().optional(),
    }).parse(req.query);
    const obligations = await listObligations(req.auth!.accessToken, orgId, collId, page);
    res.json({ obligations:page ? obligations.slice(0,25) : obligations, hasMore:page ? obligations.length>25 : false });
  } catch (err) {
    next(err);
  }
});

// Legacy workspace-based assignment is intentionally retired. Historical reads remain available.
router.post("/:organizationId/collections/:collectionId/obligations", (req, res, next) => {
  try {
    orgIdParam.parse(req.params.organizationId);
    collectionIdParam.parse(req.params.collectionId);
    res.status(410).json({ message: "Workspace-based dues assignment is retired. Select active members from Member Directory." });
  } catch (error) { next(error); }
});

const scopeAssignmentSchema=z.object({
  scope:z.enum(["all","groups","selected"]),groupIds:z.array(z.string().uuid()).max(100).default([]),
  memberIds:z.array(z.string().uuid()).max(500).default([]),amountCentavos:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  notes:z.string().trim().max(500).optional(),token:z.string().length(32).optional(),
});
router.post("/:organizationId/collections/:collectionId/dues-assignment/:step",async(req,res,next)=>{
  try {
    const orgId=orgIdParam.parse(req.params.organizationId);
    const collectionId=collectionIdParam.parse(req.params.collectionId);
    const step=z.enum(["preview","confirm"]).parse(req.params.step);
    const input=scopeAssignmentSchema.parse(req.body);
    if(step === "confirm" && !input.token) { res.status(400).json({message:"Review the assignment before confirming."});return; }
    const result=await previewOrAssignDuesScope(req.auth!.accessToken,orgId,collectionId,input,step === "confirm");
    if(result.changed) {res.status(409).json({message:"The eligible members or existing assignments changed. Review the updated assessment and confirm again.",preview:result});return;}
    res.json(result);
  } catch(error) {next(error);}
});

// Record Payment
router.post("/:organizationId/collections/:collectionId/directory-obligations", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const collectionId = collectionIdParam.parse(req.params.collectionId);
    const input = z.object({
      memberIds: z.array(z.string().uuid()).min(1).max(500),
      amountCentavos: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      notes: z.string().trim().max(500).optional(),
    }).parse(req.body);
    const assigned = await assignDirectoryObligations(req.auth!.accessToken, orgId, collectionId,
      input.memberIds, input.amountCentavos, input.notes);
    res.status(201).json({ assigned });
  } catch (error) {
    next(error);
  }
});

router.post("/:organizationId/payments", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const input = recordPaymentSchema.parse(req.body);
    const payment = await recordPayment(req.auth!.accessToken, orgId, input);
    res.status(201).json({ payment });
  } catch (err) {
    next(err);
  }
});

// Reverse Payment
router.post("/:organizationId/payments/:paymentId/reverse", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const paymentId = paymentIdParam.parse(req.params.paymentId);
    const input = reversePaymentSchema.parse(req.body);
    const payment = await reversePayment(req.auth!.accessToken, orgId, paymentId, input.reason);
    res.json({ payment });
  } catch (err) {
    next(err);
  }
});

// List Payments
router.get("/:organizationId/payments", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const filters = {
      collectionId: typeof req.query.collectionId === "string" ? req.query.collectionId : undefined,
      obligationId: typeof req.query.obligationId === "string" ? req.query.obligationId : undefined,
    };
    const payments = await listPayments(req.auth!.accessToken, orgId, filters);
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

export default router;
