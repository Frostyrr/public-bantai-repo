import { createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";
import { hydrateProfilesById } from "../../utils/profileHydration";

type BudgetTotals = { id: string; spent: number; committed: number; provisional: boolean };

export interface CreateBudgetInput {
  name: string;
  allocatedCentavos: number;
  description?: string;
  spaceId?: string;
  periodId?: string;
}

export interface SubmitExpenseInput {
  requestId?: string;
  receiptExtractions?: {extractionId: string; appliedFields: string[]}[];
  files?: {name:string;mime:string;data:string}[];
  title: string;
  amountCentavos: number;
  category: "operational" | "supplies" | "events" | "travel" | "food" | "equipment" | "services" | "other";
  incurredDate: string;
  description?: string;
  budgetId?: string | null;
  spaceId?: string;
  periodId?: string;
  receiptUrl?: string;
  vendorName?: string;
}

export interface CreateCashAdvanceInput {
  accountablePersonId: string;
  title: string;
  purpose: string;
  amountCentavos: number;
  disbursementMethod: "cash" | "bank_transfer" | "check" | "gcash" | "maya" | "other";
  referenceNumber?: string;
  budgetId?: string | null;
  spaceId?: string;
  periodId?: string;
}

export interface SubmitLiquidationInput {
  cashAdvanceId: string;
  spentCentavos: number;
  returnedCentavos: number;
  notes?: string;
}

// ----------------------------------------------------
// BUDGETS (Phase 5)
// ----------------------------------------------------
export async function listBudgets(
  accessToken: string,
  organizationId: string,
  filters?: { spaceId?: string; periodId?: string }
) {
  let query = createUserClient(accessToken)
    .from("budgets")
    .select(`
      id,
      organization_id,
      space_id,
      reporting_period_id,
      name,
      description,
      currency,
      allocated_amount_centavos,
      created_by,
      status,
      archived_at,
      archive_actor:profiles!budgets_archived_by_fkey(id, display_name),
      created_at,
      spaces(id, name),
      reporting_periods(id, name)
    `)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (filters?.spaceId) query = query.eq("space_id", filters.spaceId);
  if (filters?.periodId) query = query.eq("reporting_period_id", filters.periodId);

  const { data, error } = await query;
  if (error) throw new AppError(503, "Budgets are temporarily unavailable.");

  const budgets = data ?? [];
  if (budgets.length === 0) return [];

  const { data: accounting, error: accountingError } = await createUserClient(accessToken)
    .rpc("workspace_budget_totals", { org: organizationId, budgets: budgets.map(budget => budget.id) });

  if (accountingError || !Array.isArray(accounting)) throw new AppError(503, "Budget utilization is temporarily unavailable.");
  const accountingById = new Map((accounting as BudgetTotals[]).map((row) => [row.id, row]));
  const profileMap = await hydrateProfilesById(
    accessToken,
    budgets.map((b: any) => b.created_by)
  );

  return budgets.map((b: any) => {
    const totals = accountingById.get(b.id);
    const spentCentavos = BigInt(totals?.spent ?? 0);
    const committedCentavos = BigInt(totals?.committed ?? 0);
    const remainingCentavos = BigInt(b.allocated_amount_centavos) - spentCentavos - committedCentavos;

    return {
      ...b,
      creator_profile: b.created_by ? profileMap.get(b.created_by) ?? null : null,
      spent_centavos: Number(spentCentavos),
      committed_centavos: Number(committedCentavos),
      provisional: totals?.provisional ?? false,
      remaining_centavos: Number(remainingCentavos),
    };
  });
}

export async function getBudget(
  accessToken: string,
  organizationId: string,
  budgetId: string
) {
  const { data, error } = await createUserClient(accessToken)
    .from("budgets")
    .select(`
      id,
      organization_id,
      space_id,
      reporting_period_id,
      name,
      description,
      currency,
      allocated_amount_centavos,
      created_by,
      status,
      archived_at,
      archive_actor:profiles!budgets_archived_by_fkey(id, display_name),
      created_at,
      spaces(id, name),
      reporting_periods(id, name)
    `)
    .eq("organization_id", organizationId)
    .eq("id", budgetId)
    .maybeSingle();

  if (error) throw new AppError(503, "Budget details are temporarily unavailable.");
  if (!data) throw new AppError(404, "Budget not found.");

  const [{ data: totals, error: accountingError }, profileMap] = await Promise.all([
    createUserClient(accessToken)
      .rpc("workspace_budget_totals", { org: organizationId, budgets: [budgetId] })
      .single().overrideTypes<BudgetTotals, { merge: false }>(),
    hydrateProfilesById(accessToken, [(data as any).created_by]),
  ]);

  if (accountingError || !totals) throw new AppError(503, "Budget utilization is temporarily unavailable.");
  const spentCentavos = BigInt(totals.spent);
  const committedCentavos = BigInt(totals.committed);
  const remainingCentavos = BigInt(data.allocated_amount_centavos) - spentCentavos - committedCentavos;

  return {
    ...data,
    creator_profile: (data as any).created_by ? profileMap.get((data as any).created_by) ?? null : null,
    spent_centavos: Number(spentCentavos),
    committed_centavos: Number(committedCentavos),
    provisional: totals.provisional,
    remaining_centavos: Number(remainingCentavos),
  };
}

export async function createBudget(
  accessToken: string,
  organizationId: string,
  input: CreateBudgetInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("create_budget", {
    p_org_id: organizationId,
    p_name: input.name,
    p_allocated_centavos: input.allocatedCentavos,
    p_description: input.description ?? null,
    p_space_id: input.spaceId ?? null,
    p_period_id: input.periodId ?? null,
  });

  if (error) throw new AppError(400, error.message || "Unable to create budget.");
  return data;
}

export interface UpdateBudgetInput {
  name: string;
  allocatedCentavos: number;
  description?: string;
  spaceId?: string;
  periodId?: string;
  status?: "active" | "closed" | "archived";
}

export async function updateBudget(
  accessToken: string,
  organizationId: string,
  budgetId: string,
  input: UpdateBudgetInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("update_budget", {
    p_org_id: organizationId,
    p_budget_id: budgetId,
    p_name: input.name,
    p_allocated_centavos: input.allocatedCentavos,
    p_description: input.description ?? null,
    p_space_id: input.spaceId ?? null,
    p_period_id: input.periodId ?? null,
    p_status: input.status ?? "active",
  });

  if (error) throw new AppError(400, error.message || "Unable to update budget.");
  return data;
}

export async function deleteBudget(
  accessToken: string,
  organizationId: string,
  budgetId: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("delete_budget", {
    p_org_id: organizationId,
    p_budget_id: budgetId,
  });

  if (error) throw new AppError(error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "23514" ? 409 : 400, error.message || "Unable to delete budget.");
  return data;
}

// ----------------------------------------------------
// EXPENSES (Phase 5)
// ----------------------------------------------------
export async function listExpenses(
  accessToken: string,
  organizationId: string,
  filters?: { budgetId?: string; spaceId?: string; periodId?: string; status?: string }
) {
  const { data: projected, error: projectionError } = await createUserClient(accessToken)
    .rpc("redacted_transaction_details", { org: organizationId, kind: "expense", space: filters?.spaceId ?? null, period: filters?.periodId ?? null, filter_status: filters?.status ?? null, budget: filters?.budgetId ?? null });
  if (projectionError) throw new AppError(503, "Transactions are temporarily unavailable.");
  if (projected !== null) {
    if (!Array.isArray(projected)) throw new AppError(503, "Transactions are temporarily unavailable.");
    return projected;
  }

  let query = createUserClient(accessToken)
    .from("expenses")
    .select(`
      id,
      organization_id,
      budget_id,
      space_id,
      reporting_period_id,
      title,
      description,
      category,
      amount_centavos,
      currency,
      incurred_date,
      receipt_url,
      vendor_name,
      submitted_by,
      status,
      archived_at,
      archive_actor:profiles!expenses_archived_by_fkey(id, display_name),
      review_notes,
      approval_policy_snapshot, treasurer_approval_snapshot, approval_policy_version, required_approvals, review_revision,
      verified_by,
      verified_at,
      approved_by,
      approved_at,
      created_at,
      budgets(id, name, archived_at),
      spaces(id, name),
      reporting_periods(id, name)
    `)
    .eq("organization_id", organizationId)
    .order("incurred_date", { ascending: false });

  if (filters?.budgetId) query = query.eq("budget_id", filters.budgetId);
  if (filters?.spaceId) query = query.eq("space_id", filters.spaceId);
  if (filters?.periodId) query = query.eq("reporting_period_id", filters.periodId);
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) {
    console.error("[listExpenses] Failed to query expenses:", error);
    throw new AppError(503, "Expenses are temporarily unavailable.");
  }

  const expenses = data ?? [];
  if (expenses.length === 0) return [];
  const { data: decisions, error: decisionError } = await createUserClient(accessToken).from("approvals").select("entity_id,officer_id,decision,expense_revision,self_approval,notes,created_at").eq("organization_id", organizationId).eq("entity_type", "expense");
  if (decisionError) throw new AppError(503, "Expense review history is temporarily unavailable.");
  for (const expense of expenses as any[]) {
    expense.approval_decisions = (decisions ?? []).filter((d: any) => d.entity_id === expense.id);
  }
  if (expenses.length === 0) return [];

  // Safely hydrate submitter profile display names and avatars without relying on cross-table PostgREST joins
  const profileMap = await hydrateProfilesById(
    accessToken,
    expenses.map((e: any) => e.submitted_by)
  );

  return expenses.map((e: any) => ({
    ...e,
    profiles: e.submitted_by ? profileMap.get(e.submitted_by) ?? null : null,
  }));
}

export async function getExpense(
  accessToken: string,
  organizationId: string,
  expenseId: string
) {
  const { data: projected, error: projectionError } = await createUserClient(accessToken)
    .rpc("redacted_transaction_details", { org: organizationId, kind: "expense", target: expenseId });
  if (projectionError) throw new AppError(503, "Transactions are temporarily unavailable.");
  if (projected !== null) {
    if (!Array.isArray(projected)) throw new AppError(503, "Transactions are temporarily unavailable.");
    if (!projected.length) throw new AppError(404, "Transaction not found.");
    return projected[0];
  }

  const { data, error } = await createUserClient(accessToken)
    .from("expenses")
    .select(`
      id,
      organization_id,
      budget_id,
      space_id,
      reporting_period_id,
      title,
      description,
      category,
      amount_centavos,
      currency,
      incurred_date,
      receipt_url,
      vendor_name,
      submitted_by,
      status,
      archived_at,
      archive_actor:profiles!expenses_archived_by_fkey(id, display_name),
      review_notes,
      approval_policy_snapshot, treasurer_approval_snapshot, approval_policy_version, required_approvals, review_revision,
      verified_by,
      verified_at,
      approved_by,
      approved_at,
      created_at,
      budgets(id, name, archived_at),
      spaces(id, name),
      reporting_periods(id, name)
    `)
    .eq("organization_id", organizationId)
    .eq("id", expenseId)
    .maybeSingle();

  if (error) {
    console.error("[getExpense] Failed to query expense:", error);
    throw new AppError(503, "Expense details are temporarily unavailable.");
  }
  if (!data) {
    throw new AppError(404, "Expense not found.");
  }

  const [{ data: decisions, error: decisionError }, profileMap] = await Promise.all([
    createUserClient(accessToken)
      .from("approvals")
      .select("entity_id,officer_id,decision,expense_revision,self_approval,notes,created_at")
      .eq("organization_id", organizationId)
      .eq("entity_type", "expense")
      .eq("entity_id", expenseId),
    hydrateProfilesById(accessToken, [
      (data as any).submitted_by,
      (data as any).verified_by,
      (data as any).approved_by,
    ]),
  ]);

  if (decisionError) throw new AppError(503, "Expense review history is temporarily unavailable.");

  return {
    ...data,
    approval_decisions: decisions ?? [],
    profiles: (data as any).submitted_by ? profileMap.get((data as any).submitted_by) ?? null : null,
    verifier_profile: (data as any).verified_by ? profileMap.get((data as any).verified_by) ?? null : null,
    approver_profile: (data as any).approved_by ? profileMap.get((data as any).approved_by) ?? null : null,
  };
}

export async function submitExpense(
  accessToken: string,
  organizationId: string,
  input: SubmitExpenseInput
) {
  if (input.requestId) {
    const {requestId, files, receiptExtractions, ...draft} = input;
    const {data,error} = await createUserClient(accessToken).rpc(receiptExtractions?.length ? "submit_expense_with_ai_evidence" : files?.length ? "submit_expense_with_evidence" : "submit_reviewed_expense", {
      org: organizationId, request_id: requestId, draft, ...(files?.length ? {files} : {}),
      ...(receiptExtractions?.length ? {links: receiptExtractions} : {}),
    });
    if (error) throw new AppError(error.code === "42501" ? 403 : 400, error.message || "Unable to submit expense.");
    return data;
  }
  const { data, error } = await createUserClient(accessToken).rpc("submit_expense", {
    p_org_id: organizationId,
    p_title: input.title,
    p_amount_centavos: input.amountCentavos,
    p_category: input.category,
    p_incurred_date: input.incurredDate,
    p_description: input.description ?? null,
    p_budget_id: input.budgetId ?? null,
    p_space_id: input.spaceId ?? null,
    p_period_id: input.periodId ?? null,
    p_receipt_url: input.receiptUrl ?? null,
    p_vendor_name: input.vendorName ?? null,
  });

  if (error) throw new AppError(400, error.message || "Unable to submit expense.");
  return data;
}

export async function reviewExpense(
  accessToken: string,
  organizationId: string,
  expenseId: string,
  decision: "verified" | "approved" | "rejected",
  expectedRevision: number,
  notes?: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("review_expense", {
    p_expected_revision: expectedRevision,
    p_org_id: organizationId,
    p_expense_id: expenseId,
    p_decision: decision,
    p_notes: notes ?? null,
  });

  if (error) throw new AppError(error.code === "40001" ? 409 : error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 400, error.message || "Unable to review expense.");
  return data;
}

export interface UpdateExpenseInput {
  title: string;
  amountCentavos: number;
  category: "operational" | "supplies" | "events" | "travel" | "food" | "equipment" | "services" | "other";
  incurredDate: string;
  description?: string;
  budgetId?: string | null;
  spaceId?: string;
  periodId?: string;
  receiptUrl?: string;
  vendorName?: string;
}

export async function updateExpense(
  accessToken: string,
  organizationId: string,
  expenseId: string,
  input: UpdateExpenseInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("update_expense", {
    p_org_id: organizationId,
    p_expense_id: expenseId,
    p_title: input.title,
    p_amount_centavos: input.amountCentavos,
    p_category: input.category,
    p_incurred_date: input.incurredDate,
    p_description: input.description ?? null,
    p_budget_id: input.budgetId ?? null,
    p_space_id: input.spaceId ?? null,
    p_period_id: input.periodId ?? null,
    p_receipt_url: input.receiptUrl ?? null,
    p_vendor_name: input.vendorName ?? null,
  });

  if (error) throw new AppError(400, error.message || "Unable to update expense.");
  return data;
}

export async function deleteExpense(
  accessToken: string,
  organizationId: string,
  expenseId: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("delete_expense", {
    p_org_id: organizationId,
    p_expense_id: expenseId,
  });

  if (error) throw new AppError(400, error.message || "Unable to delete expense.");
  return data;
}

// ----------------------------------------------------
// CASH ADVANCES & LIQUIDATION (Phase 6)
// ----------------------------------------------------
export async function listCashAdvances(
  accessToken: string,
  organizationId: string,
  filters?: { status?: string; spaceId?: string; periodId?: string }
) {
  const { data: projected, error: projectionError } = await createUserClient(accessToken)
    .rpc("redacted_transaction_details", { org: organizationId, kind: "advance", space: filters?.spaceId ?? null, period: filters?.periodId ?? null, filter_status: filters?.status ?? null });
  if (projectionError) throw new AppError(503, "Transactions are temporarily unavailable.");
  if (projected !== null) {
    if (!Array.isArray(projected)) throw new AppError(503, "Transactions are temporarily unavailable.");
    return projected;
  }

  let query = createUserClient(accessToken)
    .from("cash_advances")
    .select(`
      id,
      organization_id,
      space_id,
      reporting_period_id,
      budget_id,
      accountable_person_id,
      title,
      purpose,
      amount_released_centavos,
      currency,
      disbursement_method,
      reference_number,
      released_at,
      released_by,
      status,
      created_at,
      spaces(id, name),
      reporting_periods(id, name),
      budgets(id, name),
      organization_members(
        id,
        profile_id,
        role,
        profiles(id, display_name)
      ),
      liquidations(
        submitted_by,
        id,
        total_spent_centavos,
        total_returned_centavos,
        outstanding_balance_centavos,
        status,
        reconciliation_notes,
        submitted_at,
        reviewed_at
      )
    `)
    .eq("organization_id", organizationId)
    .order("released_at", { ascending: false });

  if (filters?.spaceId) query = query.eq("space_id", filters.spaceId);
  if (filters?.periodId) query = query.eq("reporting_period_id", filters.periodId);
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw new AppError(503, "Cash advances are temporarily unavailable.");
  const advances = data ?? [];
  if (advances.length === 0) return [];

  const profileMap = await hydrateProfilesById(accessToken, [
    ...advances.map((a: any) => a.released_by),
    ...advances.map((a: any) => a.organization_members?.profile_id),
  ]);

  return advances.map((a: any) => {
    const custodianProfileId = a.organization_members?.profile_id;
    const hydratedCustodian = custodianProfileId ? profileMap.get(custodianProfileId) : undefined;
    return {
      ...a,
      released_by_profile: a.released_by ? profileMap.get(a.released_by) ?? null : null,
      organization_members: a.organization_members
        ? {
            ...a.organization_members,
            profiles: hydratedCustodian ?? a.organization_members.profiles ?? null,
          }
        : null,
    };
  });
}

export async function getCashAdvance(
  accessToken: string,
  organizationId: string,
  advanceId: string
) {
  const { data: projected, error: projectionError } = await createUserClient(accessToken)
    .rpc("redacted_transaction_details", { org: organizationId, kind: "advance", target: advanceId });
  if (projectionError) throw new AppError(503, "Transactions are temporarily unavailable.");
  if (projected !== null) {
    if (!Array.isArray(projected)) throw new AppError(503, "Transactions are temporarily unavailable.");
    if (!projected.length) throw new AppError(404, "Transaction not found.");
    return projected[0];
  }

  const { data, error } = await createUserClient(accessToken)
    .from("cash_advances")
    .select(`
      id,
      organization_id,
      space_id,
      reporting_period_id,
      budget_id,
      accountable_person_id,
      title,
      purpose,
      amount_released_centavos,
      currency,
      disbursement_method,
      reference_number,
      released_at,
      released_by,
      status,
      created_at,
      spaces(id, name),
      reporting_periods(id, name),
      budgets(id, name),
      organization_members(
        id,
        profile_id,
        role,
        profiles(id, display_name)
      ),
      liquidations(
        submitted_by,
        id,
        total_spent_centavos,
        total_returned_centavos,
        outstanding_balance_centavos,
        status,
        reconciliation_notes,
        submitted_at,
        reviewed_at
      )
    `)
    .eq("organization_id", organizationId)
    .eq("id", advanceId)
    .maybeSingle();

  if (error) throw new AppError(503, "Cash advance details are temporarily unavailable.");
  if (!data) throw new AppError(404, "Cash advance not found.");

  const advance = data as any;
  const profileMap = await hydrateProfilesById(accessToken, [
    advance.released_by,
    advance.organization_members?.profile_id,
  ]);
  const custodianProfileId = advance.organization_members?.profile_id;
  const hydratedCustodian = custodianProfileId ? profileMap.get(custodianProfileId) : undefined;

  return {
    ...advance,
    released_by_profile: advance.released_by ? profileMap.get(advance.released_by) ?? null : null,
    organization_members: advance.organization_members
      ? {
          ...advance.organization_members,
          profiles: hydratedCustodian ?? advance.organization_members.profiles ?? null,
        }
      : null,
  };
}

export async function createCashAdvance(
  accessToken: string,
  organizationId: string,
  input: CreateCashAdvanceInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("create_cash_advance", {
    p_org_id: organizationId,
    p_accountable_person_id: input.accountablePersonId,
    p_title: input.title,
    p_purpose: input.purpose,
    p_amount_centavos: input.amountCentavos,
    p_disbursement_method: input.disbursementMethod,
    p_reference_number: input.referenceNumber ?? null,
    p_budget_id: input.budgetId ?? null,
    p_space_id: input.spaceId ?? null,
    p_period_id: input.periodId ?? null,
  });

  if (error) throw new AppError(400, error.message || "Unable to create cash advance.");
  return data;
}

export async function submitLiquidation(
  accessToken: string,
  organizationId: string,
  input: SubmitLiquidationInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("submit_liquidation", {
    p_org_id: organizationId,
    p_cash_advance_id: input.cashAdvanceId,
    p_spent_centavos: input.spentCentavos,
    p_returned_centavos: input.returnedCentavos,
    p_notes: input.notes ?? null,
  });

  if (error) throw new AppError(400, error.message || "Unable to submit liquidation.");
  return data;
}

export async function reviewLiquidation(
  accessToken: string,
  organizationId: string,
  liquidationId: string,
  decision: "approved" | "rejected",
  notes?: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("review_liquidation", {
    p_org_id: organizationId,
    p_liquidation_id: liquidationId,
    p_decision: decision,
    p_notes: notes ?? null,
  });

  if (error) throw new AppError(400, error.message || "Unable to review liquidation.");
  return data;
}

export interface UpdateCashAdvanceInput {
  title: string;
  purpose: string;
  amountCentavos: number;
  disbursementMethod: "cash" | "bank_transfer" | "check" | "gcash" | "maya" | "other";
  referenceNumber?: string;
  budgetId?: string;
  spaceId?: string;
  periodId?: string;
}

export async function updateCashAdvance(
  accessToken: string,
  organizationId: string,
  advanceId: string,
  input: UpdateCashAdvanceInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("update_cash_advance", {
    p_org_id: organizationId,
    p_advance_id: advanceId,
    p_title: input.title,
    p_purpose: input.purpose,
    p_amount_centavos: input.amountCentavos,
    p_disbursement_method: input.disbursementMethod,
    p_reference_number: input.referenceNumber ?? null,
    p_budget_id: input.budgetId ?? null,
    p_space_id: input.spaceId ?? null,
    p_period_id: input.periodId ?? null,
  });

  if (error) throw new AppError(400, error.message || "Unable to update cash advance.");
  return data;
}

export async function deleteCashAdvance(
  accessToken: string,
  organizationId: string,
  advanceId: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("delete_cash_advance", {
    p_org_id: organizationId,
    p_advance_id: advanceId,
  });

  if (error) throw new AppError(400, error.message || "Unable to delete cash advance.");
  return data;
}

export async function deleteLiquidation(
  accessToken: string,
  organizationId: string,
  liquidationId: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("delete_liquidation", {
    p_org_id: organizationId,
    p_liquidation_id: liquidationId,
  });

  if (error) throw new AppError(400, error.message || "Unable to cancel liquidation.");
  return data;
}

// ----------------------------------------------------
// AUDIT LOGS & REPORTING (Phase 7)
// ----------------------------------------------------
export async function listAuditLogs(
  accessToken: string,
  organizationId: string,
  limit = 50,
  offset = 0
) {
  const { data, error } = await createUserClient(accessToken).rpc("get_organization_audit_logs", {
    p_org_id: organizationId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw new AppError(400, error.message || "Audit log retrieval failed.");
  return data ?? [];
}

export async function getFinancialSummary(
  accessToken: string,
  organizationId: string,
  filters?: { spaceId?: string; periodId?: string },
) {
  const { data, error } = await createUserClient(accessToken).rpc("workspace_financial_summary", {
    org: organizationId,
    space: filters?.spaceId ?? null,
    period: filters?.periodId ?? null,
  });
  if (error) throw new AppError(503, "Financial summary is temporarily unavailable.");
  if (data === null) throw new AppError(404, "Financial summary unavailable.");
  return data as Record<
    "total_collected_centavos" | "total_budget_allocated_centavos" | "total_expenses_centavos" |
    "directly_paid_expenses_centavos" | "advances_released_centavos" | "advance_cash_returns_centavos" |
    "approved_liquidation_spending_centavos" | "unresolved_discrepancies_centavos" |
    "written_off_discrepancies_centavos" | "budget_assigned_expenses_centavos" |
    "unallocated_expenses_centavos" | "total_outstanding_advances_centavos" | "reserve_balance_centavos",
    number
  > & { provisional: boolean; outstanding_reimbursements_centavos?: number };
}
