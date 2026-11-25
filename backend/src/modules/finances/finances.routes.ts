import { createEvidenceStorageClient, evidenceHash, expenseEvidenceBucket } from "../../config/evidenceStorage";
import { findMembership } from "../organizations/organizations.repository";
import { getFinancialInsights, insightRoles } from "./financialInsights";
import { AppError, SessionTimedOutError } from "../../utils/AppError";
import { createUserClient } from "../../config/supabase";
import { Router } from "express";
import { z } from "zod";
import { isSafeHttpUrl } from "../../utils/urlValidation";
import {
  createBudget,
  createCashAdvance,
  deleteBudget,
  deleteCashAdvance,
  deleteExpense,
  deleteLiquidation,
  getBudget,
  getCashAdvance,
  getExpense,
  getFinancialSummary,
  listAuditLogs,
  listBudgets,
  listCashAdvances,
  listExpenses,
  reviewExpense,
  reviewLiquidation,
  submitExpense,
  submitLiquidation,
  updateBudget,
  updateCashAdvance,
  updateExpense,
} from "./finances.repository";

const router = Router({ mergeParams: true });

const orgIdParam = z.string().uuid("Invalid Organization ID");
const expenseIdParam = z.string().uuid("Invalid Expense ID");
const liquidationIdParam = z.string().uuid("Invalid Liquidation ID");

const budgetIdParam = z.string().uuid("Invalid Budget ID");
const advanceIdParam = z.string().uuid("Invalid Advance ID");

const createBudgetSchema = z.object({
  name: z.string().trim().min(2, "Budget name must be at least 2 characters.").max(150),
  allocatedCentavos: z.number().int().nonnegative("Allocated budget must be non-negative"),
  description: z.string().trim().max(1000).optional(),
  spaceId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
});

const updateBudgetSchema = z.object({
  name: z.string().trim().min(2, "Budget name must be at least 2 characters.").max(150),
  allocatedCentavos: z.number().int().nonnegative("Allocated budget must be non-negative"),
  description: z.string().trim().max(1000).optional(),
  spaceId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  status: z.enum(["active", "closed", "archived"]).optional(),
});

const submitExpenseSchema = z.object({
  requestId: z.string().uuid().optional(),
  receiptExtractions: z.array(z.strictObject({ extractionId: z.uuid(), appliedFields: z.array(z.enum(["title","vendorName","incurredDate","amountCentavos"])).min(1).max(4) })).max(3).optional(),
  files: z.array(z.object({name:z.string().min(1).max(150),mime:z.enum(["image/jpeg","image/png","image/webp","application/pdf"]),data:z.string().max(1398104)})).max(3).optional(),
  title: z.string().trim().min(2, "Expense title must be at least 2 characters.").max(150),
  amountCentavos: z.number().int().positive("Expense amount must be greater than zero").max(Number.MAX_SAFE_INTEGER),
  category: z.enum(["operational", "supplies", "events", "travel", "food", "equipment", "services", "other"]),
  incurredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Incurred date must be YYYY-MM-DD."),
  description: z.string().trim().max(1000).optional(),
  budgetId: z.string().uuid().nullable().optional(),
  spaceId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  receiptUrl: z.string().trim().max(1000).refine((v) => v === "" || isSafeHttpUrl(v), "Receipt URL must use https://.").optional(),
  vendorName: z.string().trim().max(150).optional(),
}).refine(input => !input.files?.length || Boolean(input.requestId), "Attachments require a submission request ID.")
  .refine(input => !input.receiptExtractions?.length || Boolean(input.requestId && input.files?.length), "Receipt suggestions require the original attached receipt.");

const updateExpenseSchema = z.object({
  title: z.string().trim().min(2, "Expense title must be at least 2 characters.").max(150),
  amountCentavos: z.number().int().positive("Expense amount must be greater than zero"),
  category: z.enum(["operational", "supplies", "events", "travel", "food", "equipment", "services", "other"]),
  incurredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Incurred date must be YYYY-MM-DD."),
  description: z.string().trim().max(1000).optional(),
  budgetId: z.string().uuid().nullable().optional(),
  spaceId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  receiptUrl: z.string().trim().max(1000).refine((v) => v === "" || isSafeHttpUrl(v), "Receipt URL must use https://.").optional(),
  vendorName: z.string().trim().max(150).optional(),
});

const reviewExpenseSchema = z.object({
  expectedRevision: z.number().int().positive(),
  decision: z.enum(["verified", "approved", "rejected"]),
  notes: z.string().trim().max(1000).optional(),
});

const createCashAdvanceSchema = z.object({
  accountablePersonId: z.string().uuid("Invalid Accountable Person ID"),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(150),
  purpose: z.string().trim().min(3, "Purpose must be specified.").max(1000),
  amountCentavos: z.number().int().positive("Advance amount must be greater than zero"),
  disbursementMethod: z.enum(["cash", "bank_transfer", "check", "gcash", "maya", "other"]),
  referenceNumber: z.string().trim().max(100).optional(),
  budgetId: z.string().uuid().optional(),
  spaceId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
});

const updateCashAdvanceSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(150),
  purpose: z.string().trim().min(3, "Purpose must be specified.").max(1000),
  amountCentavos: z.number().int().positive("Advance amount must be greater than zero"),
  disbursementMethod: z.enum(["cash", "bank_transfer", "check", "gcash", "maya", "other"]),
  referenceNumber: z.string().trim().max(100).optional(),
  budgetId: z.string().uuid().optional(),
  spaceId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
});

const submitLiquidationSchema = z.object({
  cashAdvanceId: z.string().uuid("Invalid Cash Advance ID"),
  spentCentavos: z.number().int().nonnegative(),
  returnedCentavos: z.number().int().nonnegative(),
  notes: z.string().trim().max(1000).optional(),
});

const reviewLiquidationSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().max(1000).optional(),
});

// ----------------------------------------------------
// BUDGETS (Phase 5)
// ----------------------------------------------------
router.get("/:organizationId/budgets", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const filters = {
      spaceId: typeof req.query.spaceId === "string" ? req.query.spaceId : undefined,
      periodId: typeof req.query.periodId === "string" ? req.query.periodId : undefined,
    };
    const budgets = await listBudgets(req.auth!.accessToken, orgId, filters);
    res.json({ budgets });
  } catch (err) {
    next(err);
  }
});

router.get("/:organizationId/budgets/:budgetId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const budgetId = budgetIdParam.parse(req.params.budgetId);
    const budget = await getBudget(req.auth!.accessToken, orgId, budgetId);
    res.json({ budget });
  } catch (err) {
    next(err);
  }
});

router.get("/:organizationId/expenses/:expenseId/evidence", async (req,res,next) => {
  try {
    const org=z.string().uuid().parse(req.params.organizationId);
    const expense=z.string().uuid().parse(req.params.expenseId);
    const attachment=z.string().uuid().optional().parse(req.query.attachment);
    const client = createUserClient(req.auth!.accessToken);
    const result = await client.rpc("read_expense_evidence", { org, expense, attachment: null });
    if (result.error?.code === "session_timed_out") throw new SessionTimedOutError();
    if (result.error) {
      res.status(result.error.code === "42501" ? 403 : 503).json({ message: "Expense evidence is unavailable." });
      return;
    }
    res.set("Cache-Control", "private, no-store");
    if (!attachment) { res.json({ files: result.data }); return; }
    const file = result.data.find((entry: {id: string}) => entry.id === attachment);
    if (!file) { res.status(404).json({ message: "Attachment not found." }); return; }
    let bytes: Buffer | undefined;
    if (process.env.EXPENSE_EVIDENCE_STORAGE_SECRET) {
      const location = await client.rpc("expense_storage_location", { org, expense, attachment }).maybeSingle();
      if (location.error?.code === "session_timed_out") throw new SessionTimedOutError();
      if (!location.error && location.data) {
        const { object_path, sha256 } = location.data as { object_path: string; sha256: string };
        const copy = await createEvidenceStorageClient().storage.from(expenseEvidenceBucket).download(object_path);
        if (!copy.error && copy.data && copy.data.size <= 1048576 && copy.data.type === file.mime) {
          const candidate = Buffer.from(await copy.data.arrayBuffer());
          if (evidenceHash(candidate) === sha256) bytes = candidate;
        }
      }
    }
    if (!bytes) {
      const legacy = await client.rpc("read_expense_evidence", { org, expense, attachment });
      if (legacy.error?.code === "session_timed_out") throw new SessionTimedOutError();
      if (legacy.error || !legacy.data?.[0]) {
        res.status(legacy.error?.code === "42501" ? 403 : 503).json({ message: "Expense evidence is unavailable." });
        return;
      }
      bytes = Buffer.from(legacy.data[0].data, "base64");
    }
    res.attachment(file.name).type(file.mime).set("X-Content-Type-Options", "nosniff").send(bytes);
  } catch(error){next(error);}
});

router.post("/:organizationId/budgets", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const input = createBudgetSchema.parse(req.body);
    const budget = await createBudget(req.auth!.accessToken, orgId, input);
    res.status(201).json({ budget });
  } catch (err) {
    next(err);
  }
});

const amendmentInput = z.union([
  z.object({ amendmentId: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }),
  z.object({ expected: z.number().int().nonnegative(), proposed: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(1000) }),
]);

router.get("/:organizationId/budgets/:budgetId/amendments", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const budget = budgetIdParam.parse(req.params.budgetId);
    const { data, error } = await createUserClient(req.auth!.accessToken).from("budget_amendments")
      .select("*").eq("organization_id", org).eq("budget_id", budget).order("created_at", { ascending: false });
    if (error) throw new AppError(503, "Budget amendment history is unavailable.");
    res.json({ amendments: data });
  } catch (error) { next(error); }
});

router.post("/:organizationId/budgets/:budgetId/amendments", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const budget = budgetIdParam.parse(req.params.budgetId);
    const input = amendmentInput.parse(req.body);
    const deciding = "amendmentId" in input;
    const { data, error } = await createUserClient(req.auth!.accessToken).rpc("manage_budget_amendment", {
      org, budget, expected: deciding ? null : input.expected, proposed: deciding ? null : input.proposed,
      explanation: deciding ? null : input.reason, amendment: deciding ? input.amendmentId : null,
      decision: deciding ? input.decision : null,
    });
    if (error?.code === "23505") throw new AppError(409, "A budget amendment is already pending.");
    if (error?.code === "42501") throw new AppError(403, error.message);
    if (error?.code === "P0002") throw new AppError(404, error.message);
    if (error?.code === "23514") throw new AppError(409, error.message);
    if (error) throw new AppError(503, "Could not save the budget amendment.");
    res.json({ amendment: data });
  } catch (error) { next(error); }
});

router.post("/:organizationId/financial-archive/:recordId", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const record_id = z.string().uuid().parse(req.params.recordId);
    const {kind, archive} = z.object({kind:z.enum(["budget","expense"]),archive:z.boolean()}).parse(req.body);
    const {error} = await createUserClient(req.auth!.accessToken).rpc("set_financial_archive",{org,record_id,kind,archive});
    if (error) throw new AppError(error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "23514" ? 409 : 503,error.message);
    res.json({status:archive ? "archived" : "restored"});
  } catch (error) { next(error); }
});

router.post("/:organizationId/budgets/:budgetId/activation", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const budget = budgetIdParam.parse(req.params.budgetId);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    const { data, error } = await createUserClient(req.auth!.accessToken).rpc("decide_budget_activation", { org, budget, approve });
    if (error?.code === "42501") throw new AppError(403, error.message);
    if (error?.code === "23514") throw new AppError(409, error.message);
    if (error) throw new AppError(503, "Could not review budget activation.");
    res.json({ status: data });
  } catch (error) { next(error); }
});

router.patch("/:organizationId/budgets/:budgetId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const budgetId = budgetIdParam.parse(req.params.budgetId);
    const input = updateBudgetSchema.parse(req.body);
    const budget = await updateBudget(req.auth!.accessToken, orgId, budgetId, input);
    res.json({ budget });
  } catch (err) {
    next(err);
  }
});

router.delete("/:organizationId/budgets/:budgetId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const budgetId = budgetIdParam.parse(req.params.budgetId);
    const result = await deleteBudget(req.auth!.accessToken, orgId, budgetId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// EXPENSES (Phase 5)
// ----------------------------------------------------
router.get("/:organizationId/expenses", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const filters = {
      budgetId: typeof req.query.budgetId === "string" ? req.query.budgetId : undefined,
      spaceId: typeof req.query.spaceId === "string" ? req.query.spaceId : undefined,
      periodId: typeof req.query.periodId === "string" ? req.query.periodId : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
    };
    const expenses = await listExpenses(req.auth!.accessToken, orgId, filters);
    res.json({ expenses });
  } catch (err) {
    next(err);
  }
});

router.get("/:organizationId/expenses/:expenseId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const expId = expenseIdParam.parse(req.params.expenseId);
    const expense = await getExpense(req.auth!.accessToken, orgId, expId);
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

router.post("/:organizationId/expenses", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const input = submitExpenseSchema.parse(req.body);
    const expense = await submitExpense(req.auth!.accessToken, orgId, input);
    res.status(201).json({ expense });
  } catch (err) {
    next(err);
  }
});

router.post("/:organizationId/expenses/:expenseId/review", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const expId = expenseIdParam.parse(req.params.expenseId);
    const input = reviewExpenseSchema.parse(req.body);
    const result = await reviewExpense(req.auth!.accessToken, orgId, expId, input.decision, input.expectedRevision, input.notes);
    res.json({ review: result });
  } catch (err) {
    next(err);
  }
});

router.patch("/:organizationId/expenses/:expenseId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const expId = expenseIdParam.parse(req.params.expenseId);
    const input = updateExpenseSchema.parse(req.body);
    const expense = await updateExpense(req.auth!.accessToken, orgId, expId, input);
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

router.delete("/:organizationId/expenses/:expenseId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const expId = expenseIdParam.parse(req.params.expenseId);
    const result = await deleteExpense(req.auth!.accessToken, orgId, expId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// CASH ADVANCES & LIQUIDATION (Phase 6)
// ----------------------------------------------------
router.get("/:organizationId/advances", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const filters = {
      spaceId: z.string().uuid().optional().parse(req.query.spaceId),
      periodId: z.string().uuid().optional().parse(req.query.periodId),
      status: typeof req.query.status === "string" ? req.query.status : undefined,
    };
    const advances = await listCashAdvances(req.auth!.accessToken, orgId, filters);
    res.json({ advances });
  } catch (err) {
    next(err);
  }
});

router.get("/:organizationId/advances/:advanceId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const advanceId = advanceIdParam.parse(req.params.advanceId);
    const advance = await getCashAdvance(req.auth!.accessToken, orgId, advanceId);
    res.json({ advance });
  } catch (err) {
    next(err);
  }
});

const cashRequestFields = z.object({
  title: z.string().trim().min(2).max(150),
  purpose: z.string().trim().min(1).max(1000),
  amountCentavos: z.number().int().positive(),
});
const cashRequestVersion = z.object({ id: z.string().uuid(), revision: z.number().int().positive() });
const cashRequestAction = z.union([
  cashRequestFields.extend({ action: z.literal("create") }),
  cashRequestFields.merge(cashRequestVersion).extend({ action: z.literal("revise") }),
  cashRequestVersion.extend({ action: z.enum(["approve", "reject"]) }),
  cashRequestVersion.extend({ action: z.literal("release"), spaceId: z.uuid().optional(), periodId: z.uuid().optional(), method: z.enum(["cash","bank_transfer","check","gcash","maya","other"]), reference: z.string().trim().max(100).optional() }),
]);

router.get("/:organizationId/advance-requests", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const {data, error} = await createUserClient(req.auth!.accessToken).from("cash_advance_requests")
      .select("*").eq("organization_id", org).order("created_at", {ascending: false});
    if (error) throw new AppError(503, "Cash advance requests are unavailable.");
    res.json({requests: data});
  } catch (error) { next(error); }
});

router.delete("/:organizationId/advance-requests/:requestId", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const requestId = z.string().uuid().parse(req.params.requestId);
    const { error } = await createUserClient(req.auth!.accessToken).rpc("delete_unused_cash_request", { org, request_id: requestId });
    if (error?.code === "42501") throw new AppError(403, error.message);
    if (error?.code === "23514") throw new AppError(409, error.message);
    if (error) throw new AppError(503, "Could not delete the cash advance request.");
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post("/:organizationId/advance-requests", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const draft = cashRequestAction.parse(req.body);
    const {data, error} = await createUserClient(req.auth!.accessToken).rpc("manage_cash_advance_request", {
      org, request_id: "id" in draft ? draft.id : null, action: draft.action, draft,
    });
    if (error?.code === "42501") throw new AppError(403, error.message);
    if (error?.code === "P0002") throw new AppError(404, error.message);
    if (error?.code === "40001" || error?.code === "23514") throw new AppError(409, error.message);
    if (error) throw new AppError(503, "Could not save the cash advance request.");
    res.json({request: data});
  } catch (error) { next(error); }
});

router.post("/:organizationId/advances", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const input = createCashAdvanceSchema.parse(req.body);
    const advance = await createCashAdvance(req.auth!.accessToken, orgId, input);
    res.status(201).json({ advance });
  } catch (err) {
    next(err);
  }
});

router.patch("/:organizationId/advances/:advanceId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const advId = advanceIdParam.parse(req.params.advanceId);
    const input = updateCashAdvanceSchema.parse(req.body);
    const advance = await updateCashAdvance(req.auth!.accessToken, orgId, advId, input);
    res.json({ advance });
  } catch (err) {
    next(err);
  }
});

router.delete("/:organizationId/advances/:advanceId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const advId = advanceIdParam.parse(req.params.advanceId);
    const result = await deleteCashAdvance(req.auth!.accessToken, orgId, advId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/:organizationId/liquidations", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const input = submitLiquidationSchema.parse(req.body);
    const liquidation = await submitLiquidation(req.auth!.accessToken, orgId, input);
    res.status(201).json({ liquidation });
  } catch (err) {
    next(err);
  }
});

router.delete("/:organizationId/liquidations/:liquidationId", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const liqId = liquidationIdParam.parse(req.params.liquidationId);
    const result = await deleteLiquidation(req.auth!.accessToken, orgId, liqId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/:organizationId/liquidations/:liquidationId/review", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const liqId = liquidationIdParam.parse(req.params.liquidationId);
    const input = reviewLiquidationSchema.parse(req.body);
    const result = await reviewLiquidation(req.auth!.accessToken, orgId, liqId, input.decision, input.notes);
    res.json({ review: result });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// AUDIT LOGS & REPORTS (Phase 7)
// ----------------------------------------------------
router.get("/:organizationId/audit-logs", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const auditLogs = await listAuditLogs(req.auth!.accessToken, orgId, limit, offset);
    res.json({ auditLogs });
  } catch (err) {
    next(err);
  }
});

router.get("/:organizationId/insights", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const { accessToken, user } = req.auth!;
    const membership = await findMembership(accessToken, user.id, orgId);
    if (!membership || !insightRoles.has(membership.role)) {
      res.status(404).json({ message: "Financial insights are unavailable." });
      return;
    }
    res.set("Cache-Control", "private, no-store");
    res.json(await getFinancialInsights(accessToken, orgId));
  } catch (error) {
    next(error);
  }
});

router.get("/:organizationId/liquidations/:liquidationId/reconciliation", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const settlement = z.uuid().parse(req.params.liquidationId);
    const client = createUserClient(req.auth!.accessToken);
    const [review, entries] = await Promise.all([
      client.from("liquidation_reconciliations").select("confirmed_at, payload, reason").eq("organization_id", org).eq("liquidation_id", settlement).maybeSingle(),
      client.from("liquidation_resolution_entries").select("id, kind, amount_centavos, reverses, recorded_at, reason")
        .eq("organization_id", org).eq("liquidation_id", settlement).order("recorded_at"),
    ]);
    if (review.error || entries.error) {
      res.status(503).json({ message: "Liquidation accounting is temporarily unavailable." });
      return;
    }
    res.json({ review: review.data, entries: entries.data });
  } catch (error) {
    next(error);
  }
});

router.post("/:organizationId/liquidations/:liquidationId/reconciliation", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const settlement = z.uuid().parse(req.params.liquidationId);
    const input = z.object({
      links: z.array(z.object({
        expense_id: z.uuid(),
        amount_centavos: z.number().int().positive(),
        attributed_budget_id: z.uuid().optional(),
      })).max(100),
      reason: z.string().trim().min(3).max(1000),
    }).parse(req.body);
    const { error } = await createUserClient(req.auth!.accessToken)
      .rpc("confirm_liquidation_reconciliation", { org, settlement, ...input });
    if (error) {
      res.status(error.code === "42501" ? 403 : error.code === "23514" || error.code === "23505" ? 409 : 503)
        .json({ message: "Unable to confirm the liquidation reconciliation. Check the expense scope and remaining allocation amounts." });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/:organizationId/liquidations/:liquidationId/resolutions", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const settlement = z.uuid().parse(req.params.liquidationId);
    const input = z.object({
      request_id: z.uuid(),
      entry_kind: z.enum(["recovery", "write_off", "excess_return"]),
      amount: z.number().int().refine(amount => amount !== 0),
      reason: z.string().trim().min(3).max(1000),
      reversal: z.uuid().optional(),
    }).parse(req.body);
    const { error } = await createUserClient(req.auth!.accessToken)
      .rpc("record_liquidation_resolution", { org, settlement, ...input });
    if (error) {
      res.status(error.code === "42501" ? 403 : error.code === "23514" || error.code === "23505" ? 409 : 503)
        .json({ message: "Unable to record the liquidation resolution. Check the remaining amount and any prior entries." });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/:organizationId/closed-history", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const kind = z.enum(["expense", "advance"]).parse(req.query.kind);
    const { data, error } = await createUserClient(req.auth!.accessToken)
      .rpc("closed_transaction_history", { org, kind });
    if (error || !Array.isArray(data)) throw new AppError(503, "Historical records are temporarily unavailable.");
    res.set("Cache-Control", "private, no-store");
    res.json({ records: data });
  } catch (error) {
    next(error);
  }
});

router.get("/:organizationId/member-ledger", async (req, res, next) => {
  try {
    const org = orgIdParam.parse(req.params.organizationId);
    const { accessToken, user } = req.auth!;
    if (!await findMembership(accessToken, user.id, org)) {
      res.status(404).json({ message: "Workspace unavailable." });
      return;
    }
    const client = createUserClient(accessToken);
    const [expenses, advances, totals] = await Promise.all([
      client.rpc("member_expense_transactions", { org }),
      client.rpc("member_advance_transactions", { org }),
      client.rpc("member_ledger_totals", { org }).single(),
    ]);
    if (expenses.error || advances.error || totals.error) {
      res.status(503).json({ message: "Ledger is temporarily unavailable." });
      return;
    }
    res.set("Cache-Control", "private, no-store");
    res.json({ expenses: expenses.data, advances: advances.data, totals: totals.data });
  } catch (error) {
    next(error);
  }
});

router.get("/:organizationId/summary", async (req, res, next) => {
  try {
    const orgId = orgIdParam.parse(req.params.organizationId);
    const filters = z.object({ periodId: z.uuid().optional(), spaceId: z.uuid().optional() }).parse(req.query);
    const summary = await getFinancialSummary(req.auth!.accessToken, orgId, filters);
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

export default router;
