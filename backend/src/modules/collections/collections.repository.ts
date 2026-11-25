import { createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";
import { hydrateProfilesById } from "../../utils/profileHydration";

export interface CreateCollectionInput {
  memberScope?: {scope:string;groupIds:string[];memberIds:string[]};
  title: string;
  description?: string;
  spaceId?: string;
  periodId?: string;
  targetCentavos?: number;
  dueDate?: string;
  defaultObligationCentavos?: number;
  assignAll?: boolean;
}

export interface AssignObligationInput {
  collectionId: string;
  memberId: string;
  amountCentavos: number;
  notes?: string;
}

export interface RecordPaymentInput {
  obligationId: string;
  amountCentavos: number;
  paymentMethod: "cash" | "bank_transfer" | "gcash" | "maya" | "other";
  referenceNumber?: string;
  idempotencyKey?: string;
}

export async function listCollections(
  accessToken: string,
  organizationId: string,
  filters?: { spaceId?: string; periodId?: string; status?: string }
) {
  let query = createUserClient(accessToken)
    .from("collections")
    .select(`
      id,
      organization_id,
      space_id,
      reporting_period_id,
      title,
      description,
      currency,
      target_amount_centavos,
      due_date,
      status,
      created_by,
      created_at,
      spaces(id, name),
      reporting_periods(id, name)
    `)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (filters?.spaceId) {
    query = query.eq("space_id", filters.spaceId);
  }
  if (filters?.periodId) {
    query = query.eq("reporting_period_id", filters.periodId);
  }
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new AppError(503, "Collections are temporarily unavailable.");
  }

  const collections = data ?? [];
  if (!collections.length) return [];
  const [totals, profileMap] = await Promise.all([
    readCollectionTotals(accessToken, organizationId),
    hydrateProfilesById(accessToken, collections.map((c: any) => c.created_by)),
  ]);
  return collections.map((collection: any) => {
    const total = totals.get(collection.id);
    if (!total) throw new AppError(503, "Collection totals are temporarily unavailable.");
    return {
      ...collection,
      ...total,
      creator_profile: collection.created_by ? profileMap.get(collection.created_by) ?? null : null,
    };
  });
}

export async function getCollection(
  accessToken: string,
  organizationId: string,
  collectionId: string
) {
  const { data, error } = await createUserClient(accessToken)
    .from("collections")
    .select(`
      id,
      organization_id,
      space_id,
      reporting_period_id,
      title,
      description,
      currency,
      target_amount_centavos,
      due_date,
      status,
      created_by,
      created_at,
      spaces(id, name),
      reporting_periods(id, name)
    `)
    .eq("organization_id", organizationId)
    .eq("id", collectionId)
    .maybeSingle();

  if (error) {
    throw new AppError(503, "Collection details are temporarily unavailable.");
  }
  if (!data) {
    throw new AppError(404, "Collection not found.");
  }

  const [totals, profileMap] = await Promise.all([
    readCollectionTotals(accessToken, organizationId, collectionId),
    hydrateProfilesById(accessToken, [(data as any).created_by]),
  ]);
  const total = totals.get(collectionId);
  if (!total) throw new AppError(503, "Collection totals are temporarily unavailable.");
  return {
    ...data,
    ...total,
    creator_profile: (data as any).created_by ? profileMap.get((data as any).created_by) ?? null : null,
  };
}

export async function readCollectionTotals(accessToken: string, organizationId: string, collectionId?: string) {
  const { data, error } = await createUserClient(accessToken).rpc("collection_financial_totals", {
    target_org: organizationId, target_collection: collectionId ?? null,
  });
  if (error || !Array.isArray(data)) throw new AppError(503, "Collection totals are temporarily unavailable.");
  return new Map(data.map(({ collection_id, total_collected_centavos, total_expected_centavos, ...counts }) => {
    const collected = Number(total_collected_centavos);
    const expected = Number(total_expected_centavos);
    if (!Number.isSafeInteger(collected) || !Number.isSafeInteger(expected)) {
      throw new AppError(503, "Collection totals exceed the supported range.");
    }
    return [collection_id, { ...counts, total_collected_centavos: collected, total_expected_centavos: expected }];
  }));
}

export async function assignDirectoryObligations(accessToken: string, orgId: string, collectionId: string,
  memberIds: string[], amountCentavos: number, notes?: string) {
  const { data, error } = await createUserClient(accessToken).rpc("assign_directory_obligations", {
    target_org: orgId, target_collection: collectionId, target_members: memberIds,
    assessed_centavos: amountCentavos, assignment_notes: notes ?? null,
  });
  if (error?.code === "42501") throw new AppError(403, "You cannot assign collection dues.");
  if (error?.code === "23505") throw new AppError(409, "A selected member already has dues for this collection.");
  if (error?.code === "23514") throw new AppError(400, error.message);
  if (error) throw new AppError(503, "Could not assign collection dues.");
  return data;
}

export async function createCollection(
  accessToken: string,
  organizationId: string,
  input: CreateCollectionInput
) {
  const { data, error } = await createUserClient(accessToken).rpc(input.memberScope ? "create_scoped_collection" : "create_collection", {
    p_org_id: organizationId,
    p_title: input.title,
    p_description: input.description ?? null,
    p_space_id: input.spaceId ?? null,
    p_period_id: input.periodId ?? null,
    p_target_centavos: input.targetCentavos ?? 0,
    p_due_date: input.dueDate ?? null,
    ...(input.memberScope ? {p_scope:input.memberScope.scope,p_group_ids:input.memberScope.groupIds,p_member_ids:input.memberScope.memberIds}
      : {p_default_obligation_centavos:input.defaultObligationCentavos??0,p_assign_all:Boolean(input.assignAll)}),
  });

  if (error) {
    throw new AppError(400, error.message || "Unable to create collection.");
  }
  return data;
}

export async function listObligations(
  accessToken: string,
  organizationId: string,
  collectionId: string,
  page?: { page: number; q: string; status: string; obligationId?: string }
) {
  const client = createUserClient(accessToken);
  let ids: string[] | undefined;
  if (page) {
    const result = await client.rpc("collection_roster_page", {target_org:organizationId,target_collection:collectionId,
      page_offset:page.page*25,search_text:page.q,payment_status:page.status,target_obligation:page.obligationId ?? null});
    if (result.error?.code === "42501") throw new AppError(403,"You cannot view member finances.");
    if (result.error || !Array.isArray(result.data)) throw new AppError(503,"Obligation roster is temporarily unavailable.");
    ids = result.data.map(row => row.id);
    if (!ids.length) return [];
  }
  const query = client.from("obligations")
    .select(`
      id,
      collection_id,
      member_id,
      directory_member_id,
      amount_centavos,
      status,
      notes,
      created_at,
      organization_directory_members!obligations_directory_member_fkey(id, display_name, member_code, attributes, status),
      organization_members(
        id,
        profile_id,
        role,
        profiles(id, display_name)
      )
    `)
    .eq("organization_id", organizationId)
    .eq("collection_id", collectionId)
    .order("created_at", { ascending: true }).order("id");
  if (ids) query.in("id", ids);
  const { data, error } = await query;

  if (error) {
    throw new AppError(503, "Obligation roster is temporarily unavailable.");
  }

  const obligations = data ?? [];
  if (obligations.length === 0) return [];

  // Shared SQL calculation also powers Member Details, including reversals and waivers.
  const { data: totals, error: totalsError } = await createUserClient(accessToken).rpc("collection_obligation_financials", {
    target_org: organizationId, target_collection: collectionId, target_obligations: obligations.map(row => row.id),
  });
  if (totalsError?.code === "42501") throw new AppError(403, "You cannot view member finances.");
  if (totalsError || !Array.isArray(totals)) throw new AppError(503, "Obligation payments are temporarily unavailable.");
  const byId = new Map(totals.map(row => [row.obligation_id, row]));
  return obligations.map(ob => {
    const total = byId.get(ob.id);
    if (!total) throw new AppError(503, "Obligation payments are temporarily unavailable.");
    const paid = Number(total.paid_centavos);
    const remaining = Number(total.remaining_centavos);
    if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(remaining)) throw new AppError(503, "Obligation totals exceed the supported range.");
    return { ...ob, paid_centavos: paid, remaining_centavos: remaining };
  });
}

export async function assignObligation(
  accessToken: string,
  organizationId: string,
  input: AssignObligationInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("assign_member_obligation", {
    p_org_id: organizationId,
    p_collection_id: input.collectionId,
    p_member_id: input.memberId,
    p_amount_centavos: input.amountCentavos,
    p_notes: input.notes ?? null,
  });

  if (error) {
    throw new AppError(400, error.message || "Unable to assign obligation.");
  }
  return data;
}

export async function recordPayment(
  accessToken: string,
  organizationId: string,
  input: RecordPaymentInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("record_payment", {
    p_org_id: organizationId,
    p_obligation_id: input.obligationId,
    p_amount_centavos: input.amountCentavos,
    p_payment_method: input.paymentMethod,
    p_reference_number: input.referenceNumber ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) {
    if (error.code === "PT409") {
      throw new AppError(409, "This payment key was already used with different payment details.");
    }
    throw new AppError(400, error.message || "Unable to record payment.");
  }
  return data;
}

export async function reversePayment(
  accessToken: string,
  organizationId: string,
  paymentId: string,
  reason: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("reverse_payment", {
    p_org_id: organizationId,
    p_payment_id: paymentId,
    p_reason: reason,
  });

  if (error) {
    throw new AppError(400, error.message || "Unable to reverse payment.");
  }
  return data;
}

export async function listPayments(
  accessToken: string,
  organizationId: string,
  filters?: { collectionId?: string; obligationId?: string }
) {
  let query = createUserClient(accessToken)
    .from("payments")
    .select(`
      id,
      organization_id,
      collection_id,
      obligation_id,
      amount_centavos,
      payment_method,
      reference_number,
      receipt_number,
      idempotency_key,
      status,
      reversal_reason,
      reversed_at,
      reversed_by,
      recorded_by,
      paid_at,
      created_at,
      collections(id, title, currency),
      obligations(
        organization_directory_members!obligations_directory_member_fkey(id, display_name, member_code, attributes, status),
        id,
        member_id,
        organization_members(
          id,
          profile_id,
          profiles(id, display_name)
        )
      )
    `)
    .eq("organization_id", organizationId)
    .order("paid_at", { ascending: false });

  if (filters?.collectionId) {
    query = query.eq("collection_id", filters.collectionId);
  }
  if (filters?.obligationId) {
    query = query.eq("obligation_id", filters.obligationId);
  }

  const { data, error } = await query;
  if (error) {
    throw new AppError(503, "Payment records are temporarily unavailable.");
  }
  return data ?? [];
}

export async function listUserObligations(accessToken: string, userId: string) {
  const { data, error } = await createUserClient(accessToken)
    .from("obligations")
    .select(`
      id,
      amount_centavos,
      status,
      notes,
      created_at,
      collections(
        id,
        title,
        currency,
        due_date,
        organization_id,
        organizations(id, name)
      ),
      organization_members!inner(profile_id)
    `)
    .eq("organization_members.profile_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new AppError(503, "Personal payment obligations are temporarily unavailable.");
  }

  const obligations = data ?? [];
  if (obligations.length === 0) return [];

  // Fetch payments for these obligations to provide paid & remaining amounts
  const obligationIds = obligations.map((o) => o.id);
  const { data: paymentsData } = await createUserClient(accessToken)
    .from("payments")
    .select("obligation_id, amount_centavos, receipt_number, payment_method, paid_at, status")
    .in("obligation_id", obligationIds)
    .eq("status", "completed");

  const payments = paymentsData ?? [];

  return obligations.map((ob) => {
    const obPayments = payments.filter((p) => p.obligation_id === ob.id);
    const paidCentavos = obPayments.reduce(
      (sum, p) => sum + BigInt(p.amount_centavos),
      BigInt(0)
    );
    const totalCentavos = BigInt(ob.amount_centavos);
    const remainingCentavos =
      totalCentavos > paidCentavos ? totalCentavos - paidCentavos : BigInt(0);

    return {
      ...ob,
      paid_centavos: Number(paidCentavos),
      remaining_centavos: Number(remainingCentavos),
      payments: obPayments,
    };
  });
}

export interface UpdateCollectionInput {
  title: string;
  description?: string;
  targetCentavos?: number;
  dueDate?: string;
  spaceId?: string;
  status?: "active" | "closed" | "archived";
}

export async function updateCollection(
  accessToken: string,
  organizationId: string,
  collectionId: string,
  input: UpdateCollectionInput
) {
  const { data, error } = await createUserClient(accessToken).rpc("update_collection", {
    p_org_id: organizationId,
    p_collection_id: collectionId,
    p_title: input.title,
    p_description: input.description ?? null,
    p_target_centavos: input.targetCentavos ?? 0,
    p_due_date: input.dueDate ?? null,
    p_space_id: input.spaceId ?? null,
    p_status: input.status ?? "active",
  });

  if (error) throw new AppError(400, error.message || "Unable to update collection.");
  return data;
}

export async function deleteCollection(
  accessToken: string,
  organizationId: string,
  collectionId: string,
  confirmation: string
) {
  const { data, error } = await createUserClient(accessToken).rpc("delete_collection", {
    confirmation,
    p_org_id: organizationId,
    p_collection_id: collectionId,
  });

  if (error) throw new AppError(400, error.message || "Unable to delete collection.");
  return data;
}

export async function previewOrAssignDuesScope(accessToken:string,orgId:string,collectionId:string,
 input:{scope:"all"|"groups"|"selected";groupIds:string[];memberIds:string[];amountCentavos:number;notes?:string;token?:string},apply:boolean) {
 const {data,error}=await createUserClient(accessToken).rpc("collection_dues_scope",{
  target_org:orgId,target_collection:collectionId,assignment_scope:input.scope,group_ids:input.groupIds,member_ids:input.memberIds,
  assessed_centavos:input.amountCentavos,assignment_notes:input.notes??null,apply_assignment:apply,expected_token:input.token??null,
 });
 if(error?.code === "42501") throw new AppError(403,"You cannot assign collection dues.");
 if(error?.code === "23514") throw new AppError(400,error.message);
 if(error?.code === "23505") throw new AppError(409,"An assignment changed. Review the scope again.");
 if(error) throw new AppError(503,"Could not resolve the assignment. Please try again.");
 return data;
}

export async function collectionMemberRpc(token:string, name:string, args:Record<string,unknown>) {
  const {data,error}=await createUserClient(token).rpc(name,args);
  if(error?.code==="42501") throw new AppError(403,error.message);
  if(error?.code==="23514") throw new AppError(400,error.message);
  if(error?.code==="P0002") throw new AppError(404,error.message);
  if(error) throw new AppError(503,"Collection membership is temporarily unavailable.");
  return data;
}
