import type { CollectionAmountFilters } from "../components/org/collections/CollectionAmountFilter";
import type { AxiosProgressEvent } from "axios";
import type { OrganizationType } from "./organizationTypes";
import API, { clearRejectedBrowserSession, type FinancialReadRequest } from "../config/apiClient";
import { supabase } from "../config/supabase";
import { ApiRequestError, resolveAuthenticatedUser, resolveSafeSession } from "../config/sessionRecovery";
import type { ThemePreference } from "../context/ThemeContext";
import type { PersonalIdentity } from "./identity";
import {parsePasswordHistoryStatus} from "./passwordHistoryStatus";

interface Credentials {
  email: string;
  password: string;
  captchaToken?: string;
}
export type PlatformRole = "user" | "admin" | "super_admin";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  username?:string|null;
  personalIdentity?:PersonalIdentity;
  onboardingStep?: "name" | "appearance" | null;
  avatarUrl?: string | null;
  platformRole?: PlatformRole;
  providers?: string[];
  verified: boolean;
  createdAt: string;
}

export interface UserPreferences {
  theme: ThemePreference;
  reduced_motion: boolean;
  default_organization_id: string | null;
  notifications: {
    email_approvals?: boolean;
    email_payments?: boolean;
    email_invites?: boolean;
    in_app_approvals?: boolean;
    in_app_payments?: boolean;
    in_app_invites?: boolean;
    [key: string]: boolean | undefined;
  };
}
export interface OrganizationDetails {
  id: string;
  name: string;
  currency?: string;
  time_zone?: string | null;
  invite_code?: string;
  description?: string | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
  cover_theme?: string | null;
}
export interface Membership {
  display_name?:string|null;
  can_submit_expenses?: boolean;
  id?: string;
  profile_id?: string;
  organization_id: string;
  role: "owner" | "organization_admin" | "treasurer" | "auditor" | "member" | "student";
  organizations: OrganizationDetails | null;
}
export interface OrganizationMember {
  can_submit_expenses?: boolean;
  id: string;
  profile_id: string;
  role: "owner" | "organization_admin" | "treasurer" | "auditor" | "member" | "student";
  status: "active" | "suspended";
  created_at: string;
  profiles: { id: string; display_name: string | null; username?:string|null; avatar_url?: string | null } | null;
}
const callbackUrl = () => `${window.location.origin}/auth/callback`;
export const login = async (credentials: Omit<Credentials, "email"> & { identifier: string }) => {
  const { data } = await API.post<{
    session: { access_token: string; refresh_token: string };
  }>("/auth/login", credentials);
  const { error } = await supabase.auth.setSession(data.session);
  if (error) throw error;
};
export const loginWithGoogle = async () => {
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl() } });
  if (error) throw error;
};
export const logout = async (scope: "local" | "global" = "local") => {
  const { error } = await supabase.auth.signOut({ scope });
  if (error) throw error;
};
export const register = async (payload:Credentials & PersonalIdentity) => { await API.post("/auth/register",payload); };
export const resendVerificationEmail = async (email: string, captchaToken?: string) => {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: callbackUrl(), captchaToken },
  });
  if (error) throw error;
};
export interface InquiryPayload {
  name: string;
  email: string;
  orgName?: string;
  inquiryType: "officer" | "treasurer" | "pricing" | "other";
  message: string;
  captchaToken: string;
}
export const submitInquiry = async (payload: InquiryPayload) => {
  const { data } = await API.post<{ ok: boolean; message: string }>("/inquiries", payload);
  return data;
};
export const getUser = async (): Promise<UserProfile | null> =>
  resolveAuthenticatedUser({
    auth: supabase.auth,
    clearOnUnauthorized: false,
    fetchUser: async (session) =>
      (
        await API.get<UserProfile>("/user", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      ).data,
  });

export const updateUserProfile = async (
  payload: { avatarUrl?: string | null },
  account?: FinancialReadRequest,
) => (await API.patch<{ profile: { id: string; display_name: string; avatar_url: string | null; onboarding_step: UserProfile["onboardingStep"] } }>(
  "/user/profile", payload, { ...account },
)).data.profile;

export const completeAccountOnboarding = async (theme: ThemePreference, account: FinancialReadRequest) =>
  (await API.post<{ theme: ThemePreference }>("/user/onboarding/complete", { theme }, { ...account })).data.theme;

export const getUserPreferences = async (account: FinancialReadRequest) =>
  (await API.get<{ preferences: UserPreferences }>("/user/preferences", { ...account })).data.preferences;

export const updateUserPreferences = async (payload: {
  theme?: ThemePreference;
  reducedMotion?: boolean;
  defaultOrganizationId?: string | null;
  notifications?: Record<string, boolean>;
}, account?: FinancialReadRequest) =>
  (await API.patch<{ preferences: UserPreferences }>("/user/preferences", payload, { ...account })).data.preferences;

export const leaveOrganization = async (orgId: string) =>
  (await API.post<{ success: boolean; result: unknown }>(`/user/organizations/${orgId}/leave`)).data;

export const deleteAccount = async () =>
  (await API.post<{ success: boolean; message: string }>("/user/delete-account")).data;

export const changePassword = async (newPassword: string, currentPassword: string, nonce?: string, authorization?:string) => {
  await API.get("/user/session");
  const {data:questions}=await API.get<{enabled:boolean}>("/user/security-questions");
  if(questions.enabled) throw new Error("Recovery questions are enabled. Use Forgot password on the sign-in page to verify your email, authenticator, and recovery answers before choosing a new password.");
  const history=parsePasswordHistoryStatus((await API.get("/auth/password-history/status")).data);
  if(!history.acceptingChanges)throw new Error("Password changes are temporarily paused. Verified recovery remains available.");
  if(history.enabled===true){
    if(!authorization)throw new Error("Verify a password-change email code first.");
    await API.post("/user/password-history/change",{password:newPassword,currentPassword,nonce,authorization});return;
  }
  if(history.enabled!==false)throw new Error("Password verification is temporarily unavailable.");
  const { error } = await supabase.auth.updateUser({ password: newPassword, current_password: currentPassword, nonce });
  if (error) throw error;
};
export const setInitialPassword = async (newPassword: string, nonce?: string, authorization?: string) => {
  await API.get("/user/session");
  const history = parsePasswordHistoryStatus((await API.get("/auth/password-history/status")).data);
  if (!history.acceptingChanges) throw new Error("Password updates are temporarily paused.");
  if (history.enabled === true) {
    if (!authorization) throw new Error("Verify an email authorization code first.");
    await API.post("/user/password-history/set", { password: newPassword, nonce, authorization });
    return;
  }
  if (history.enabled !== false) throw new Error("Password verification is temporarily unavailable.");
  const { error } = await supabase.auth.updateUser({ password: newPassword, nonce });
  if (error) throw error;
};
export const requestPasswordChangeCode = async () => {
  await API.get("/user/session");
  const { error } = await supabase.auth.reauthenticate();
  if (error) throw error;
};
export const requestEmailChange = async (email: string) => {
  await API.get("/user/session");
  const { error } = await supabase.auth.updateUser({ email }, {
    emailRedirectTo: callbackUrl() + "?account=email-change",
  });
  if (error) throw error;
};
export const getOrganizations = async () =>
  (await API.get<{ memberships: Membership[] }>("/organizations")).data.memberships;
export const getOrganization = async (id: string) =>
  (await API.get<{ membership: Pick<Membership, "organization_id" | "role"> & { organizations?: OrganizationDetails } }>(`/organizations/${id}`)).data.membership;

export const createOrganization = async (payload: { name: string; currency?: string; timeZone?: string; organizationType: OrganizationType; requestId: string }) =>
  (await API.post<{ organization: OrganizationDetails & { role: string } }>("/organizations", payload)).data.organization;

export const joinOrganization = async (payload: { code: string }) =>
  (await API.post<{ organization: OrganizationDetails & { role: string } }>("/organizations/join", payload)).data.organization;

export const getOrganizationMembers = async (id: string) =>
  (await API.get<{ members: OrganizationMember[] }>(`/organizations/${id}/members`)).data.members;

export const updateOrganizationLogo = async (id: string, logoUrl: string | null) =>
  (await API.patch<{ organization: OrganizationDetails }>(`/organizations/${id}/logo`, { logoUrl })).data.organization;

export const updateOrganizationCover = async (
  id: string,
  payload: { coverImageUrl: string | null; coverTheme: string | null }
) =>
  (await API.patch<{ organization: { success: boolean; cover_image_url: string | null; cover_theme: string | null } }>(`/organizations/${id}/cover`, payload)).data.organization;

export const updateOrganization = async (id: string, payload: { name: string; currency?: string; description?: string }) =>
  (await API.patch<{ organization: OrganizationDetails }>(`/organizations/${id}`, payload)).data.organization;

export const updateOrganizationRegionalSettings = async (
  id: string,
  payload: { currency?: string; timeZone?: string }
) =>
  (await API.patch<{ organization: Pick<OrganizationDetails, "id" | "currency" | "time_zone"> }>(`/organizations/${id}/regional-settings`, payload)).data.organization;

export const regenerateInviteCode = async (id: string) =>
  (await API.post<{ invite_code: string }>(`/organizations/${id}/regenerate-invite`)).data;

export interface OrgDeletability {
  organization_id: string;
  is_deletable: boolean;
  unliquidated_count: number;
  unliquidated_amount_centavos: number;
  members_count: number;
  reasons: string[];
}

export const getOrgDeletability = async (orgId: string) =>
  (await API.get<{ deletability: OrgDeletability }>(`/organizations/${orgId}/deletability`)).data.deletability;

export const transferOrganizationOwnership = async (
  orgId: string,
  payload: { targetMemberId: string; currentOwnerRole?: string }
) =>
  (await API.post<{ result: unknown }>(`/organizations/${orgId}/transfer-ownership`, payload)).data.result;

export const deleteOrganization = async (
  orgId: string,
  payload: { confirmName: string }
) =>
  (await API.delete<{ success: boolean; message: string }>(`/organizations/${orgId}`, { data: payload })).data;

export interface ReportingPeriod {
  id: string;
  organization_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "active" | "closed" | "upcoming";
  is_default: boolean;
  created_at: string;
}

export interface Space {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: "active" | "archived" | "completed";
  created_by: string | null;
  created_at: string;
}

export const getReportingPeriods = async (orgId: string) =>
  (await API.get<{ periods: ReportingPeriod[] }>(`/organizations/${orgId}/periods`)).data.periods;

export const createReportingPeriod = async (
  orgId: string,
  payload: { name: string; startDate: string; endDate: string; isDefault?: boolean }
) =>
  (await API.post<{ period: ReportingPeriod }>(`/organizations/${orgId}/periods`, payload)).data.period;

export const getSpaces = async (orgId: string) =>
  (await API.get<{ spaces: Space[] }>(`/organizations/${orgId}/spaces`)).data.spaces;

export const createSpace = async (
  orgId: string,
  payload: { name: string; description?: string }
) =>
  (await API.post<{ space: Space }>(`/organizations/${orgId}/spaces`, payload)).data.space;

export const updateMemberRole = async (orgId: string, memberId: string, role: string) =>
  (await API.patch<{ member: OrganizationMember }>(`/organizations/${orgId}/members/${memberId}/role`, { role })).data.member;

export interface Collection {
  id: string;
  organization_id: string;
  space_id: string | null;
  reporting_period_id: string | null;
  title: string;
  description: string | null;
  currency: string;
  target_amount_centavos: number;
  due_date: string | null;
  status: "active" | "closed" | "archived";
  created_by?: string | null;
  created_at: string;
  creator_profile?: { id: string; display_name: string | null; avatar_url?: string | null } | null;
  spaces?: { id: string; name: string } | null;
  reporting_periods?: { id: string; name: string } | null;
  total_obligations_count?: number;
  paid_obligations_count?: number;
  partially_paid_count?: number;
  pending_count?: number;
  total_collected_centavos?: number;
  total_expected_centavos?: number;
}

export interface Obligation {
  id: string;
  collection_id: string;
  member_id: string | null;
  organization_directory_members?: { id: string; display_name: string; member_code: string | null; attributes: Record<string, string | number | boolean>; status: "active" | "archived" } | null;
  amount_centavos: number;
  status: "pending" | "partially_paid" | "paid" | "waived";
  notes: string | null;
  created_at: string;
  paid_centavos?: number;
  remaining_centavos?: number;
  organization_members?: {
    id: string;
    profile_id: string;
    role: string;
    profiles?: { id: string; display_name: string | null } | null;
  };
  collections?: {
    id: string;
    title: string;
    currency: string;
    due_date: string | null;
    organization_id: string;
    organizations?: { id: string; name: string } | null;
  };
  payments?: Payment[];
}

export interface Payment {
  id: string;
  organization_id: string;
  collection_id: string;
  obligation_id: string;
  amount_centavos: number;
  payment_method: "cash" | "bank_transfer" | "gcash" | "maya" | "other";
  reference_number: string | null;
  receipt_number: string;
  idempotency_key: string;
  status: "completed" | "reversed";
  reversal_reason: string | null;
  reversed_at: string | null;
  paid_at: string;
  created_at: string;
  collections?: { id: string; title: string; currency: string } | null;
  obligations?: {
    id: string;
    member_id: string | null;
    organization_directory_members?: { id: string; display_name: string; member_code: string | null; attributes: Record<string, string | number | boolean>; status: "active" | "archived" } | null;
    organization_members?: {
      id: string;
      profile_id: string;
      profiles?: { id: string; display_name: string | null } | null;
    } | null;
  } | null;
}

export type CollectionMemberScope = { scope: "all" | "groups" | "selected"; groupIds: string[]; memberIds: string[] };

export interface CreateCollectionPayload {
  assessment?: {amount:number;automatic:boolean;token:string;requestId:string};
  memberScope?: CollectionMemberScope;
  title: string;
  description?: string;
  spaceId?: string;
  periodId?: string;
  targetCentavos?: number;
  dueDate?: string;
  defaultObligationCentavos?: number;
  assignAll?: boolean;
}

export interface RecordPaymentPayload {
  obligationId: string;
  amountCentavos: number;
  paymentMethod: "cash" | "bank_transfer" | "gcash" | "maya" | "other";
  referenceNumber?: string;
  idempotencyKey?: string;
}

export const getCollections = async (
  orgId: string,
  filters?: { spaceId?: string; periodId?: string; status?: string },
  request?: FinancialReadRequest,
) => {
  const params = new URLSearchParams();
  if (filters?.spaceId) params.set("spaceId", filters.spaceId);
  if (filters?.periodId) params.set("periodId", filters.periodId);
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return (await API.get<{ collections: Collection[] }>(`/organizations/${orgId}/collections${qs}`, request)).data.collections;
};

export const getCollection = async (orgId: string, collectionId: string, signal?: AbortSignal) =>
  (await API.get<{ collection: Collection }>(`/organizations/${orgId}/collections/${collectionId}`, { signal })).data.collection;

export const createCollection = async (orgId: string, payload: CreateCollectionPayload) =>
  (await API.post<{ collection: Collection }>(`/organizations/${orgId}/collections`, payload)).data.collection;

export const getObligations = async (orgId: string, collectionId: string) =>
  (await API.get<{ obligations: Obligation[] }>(`/organizations/${orgId}/collections/${collectionId}/obligations`)).data.obligations;

export const assignObligation = async (
  orgId: string,
  collectionId: string,
  payload: { memberId: string; amountCentavos: number; notes?: string }
) =>
  (await API.post<{ obligation: Obligation }>(`/organizations/${orgId}/collections/${collectionId}/obligations`, payload)).data.obligation;

export const recordPayment = async (orgId: string, payload: RecordPaymentPayload) =>
  (await API.post<{ payment: Payment }>(`/organizations/${orgId}/payments`, payload)).data.payment;

export const reversePayment = async (orgId: string, paymentId: string, reason: string) =>
  (await API.post<{ payment: Payment }>(`/organizations/${orgId}/payments/${paymentId}/reverse`, { reason })).data.payment;

export const getPayments = async (
  orgId: string,
  filters?: { collectionId?: string; obligationId?: string }
) => {
  const params = new URLSearchParams();
  if (filters?.collectionId) params.set("collectionId", filters.collectionId);
  if (filters?.obligationId) params.set("obligationId", filters.obligationId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return (await API.get<{ payments: Payment[] }>(`/organizations/${orgId}/payments${qs}`)).data.payments;
};

export const getUserObligations = async () =>
  (await API.get<{ obligations: Obligation[] }>("/user/obligations")).data.obligations;

export interface Budget {
  archived_at?: string | null;
  archive_actor?: { display_name: string | null } | null;
  id: string;
  organization_id: string;
  space_id: string | null;
  reporting_period_id: string | null;
  name: string;
  description: string | null;
  currency: string;
  allocated_amount_centavos: number;
  status: "active" | "closed" | "archived" | "pending_approval" | "rejected";
  created_by?: string;
  created_at: string;
  creator_profile?: { id: string; display_name: string | null; avatar_url?: string | null } | null;
  spaces?: { id: string; name: string } | null;
  reporting_periods?: { id: string; name: string } | null;
  spent_centavos?: number;
  committed_centavos?: number;
  provisional?: boolean;
  remaining_centavos?: number;
}

export interface Expense {
  archived_at?: string | null;
  archive_actor?: { display_name: string | null } | null;
  approval_policy_snapshot?: 'legacy' | 'standard' | 'owner_admin_self' | 'strict';
  treasurer_approval_snapshot?: boolean;
  required_approvals?: number;
  review_revision?: number;
  approval_decisions?: { officer_id: string; decision: string; expense_revision: number | null; self_approval: boolean; notes: string | null; created_at: string }[];
  id: string;
  organization_id: string;
  budget_id: string | null;
  space_id: string | null;
  reporting_period_id: string | null;
  title: string;
  description: string | null;
  category: "operational" | "supplies" | "events" | "travel" | "food" | "equipment" | "services" | "other";
  amount_centavos: number;
  currency: string;
  incurred_date: string;
  receipt_url: string | null;
  vendor_name: string | null;
  submitted_by: string;
  status: "pending" | "verified" | "approved" | "rejected" | "cancelled";
  review_notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  budgets?: { id: string; name: string; archived_at?: string | null } | null;
  spaces?: { id: string; name: string } | null;
  reporting_periods?: { id: string; name: string } | null;
  profiles?: { id: string; display_name: string | null; avatar_url?: string | null } | null;
  verifier_profile?: { id: string; display_name: string | null; avatar_url?: string | null } | null;
  approver_profile?: { id: string; display_name: string | null; avatar_url?: string | null } | null;
}

export interface CashAdvance {
  id: string;
  organization_id: string;
  space_id: string | null;
  reporting_period_id: string | null;
  budget_id: string | null;
  accountable_person_id: string;
  title: string;
  purpose: string;
  amount_released_centavos: number;
  currency: string;
  disbursement_method: "cash" | "bank_transfer" | "check" | "gcash" | "maya" | "other";
  reference_number: string | null;
  released_at: string;
  released_by?: string | null;
  status: "outstanding" | "under_review" | "liquidated" | "disputed";
  created_at: string;
  released_by_profile?: { id: string; display_name: string | null; avatar_url?: string | null } | null;
  spaces?: { id: string; name: string } | null;
  reporting_periods?: { id: string; name: string } | null;
  budgets?: { id: string; name: string } | null;
  organization_members?: {
    id: string;
    profile_id: string;
    role: string;
    profiles?: { id: string; display_name: string | null; avatar_url?: string | null } | null;
  } | null;
  liquidations?: Liquidation[] | Liquidation | null;
}

export interface Liquidation {
  submitted_by: string;
  id: string;
  cash_advance_id: string;
  total_spent_centavos: number;
  total_returned_centavos: number;
  outstanding_balance_centavos: number;
  reconciliation_notes: string | null;
  status: "draft" | "submitted" | "approved" | "rejected";
  submitted_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
}

export interface AuditLog {
  id: number;
  organization_id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_id: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  occurred_at: string;
}

export interface FinancialSummary {
  total_collected_centavos: number;
  total_budget_allocated_centavos: number;
  total_expenses_centavos: number;
  approved_liquidation_spending_centavos: number;
  directly_paid_expenses_centavos: number;
  unresolved_discrepancies_centavos: number;
  provisional: boolean;
  total_outstanding_advances_centavos: number;
  outstanding_reimbursements_centavos?: number;
  reserve_balance_centavos: number;
}

export const getBudgets = async (
  orgId: string,
  filters?: { spaceId?: string; periodId?: string },
  request?: FinancialReadRequest,
) => {
  const params = new URLSearchParams();
  if (filters?.spaceId) params.set("spaceId", filters.spaceId);
  if (filters?.periodId) params.set("periodId", filters.periodId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return (await API.get<{ budgets: Budget[] }>(`/organizations/${orgId}/budgets${qs}`, request)).data.budgets;
};

export const getBudget = async (orgId: string, budgetId: string, signal?: AbortSignal, request?: FinancialReadRequest) =>
  (await API.get<{ budget: Budget }>(`/organizations/${orgId}/budgets/${encodeURIComponent(budgetId)}`, { ...request, signal })).data.budget;

export const createBudget = async (
  orgId: string,
  payload: { name: string; allocatedCentavos: number; description?: string; spaceId?: string; periodId?: string }
) =>
  (await API.post<{ budget: Budget }>(`/organizations/${orgId}/budgets`, payload)).data.budget;

export const getExpenses = async (
  orgId: string,
  filters?: { budgetId?: string; spaceId?: string; periodId?: string; status?: string },
  request?: FinancialReadRequest,
) => {
  const params = new URLSearchParams();
  if (filters?.budgetId) params.set("budgetId", filters.budgetId);
  if (filters?.spaceId) params.set("spaceId", filters.spaceId);
  if (filters?.periodId) params.set("periodId", filters.periodId);
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return (await API.get<{ expenses: Expense[] }>(`/organizations/${orgId}/expenses${qs}`, request)).data.expenses;
};

export const getExpense = async (orgId: string, expenseId: string, signal?: AbortSignal) =>
  (await API.get<{ expense: Expense }>(`/organizations/${orgId}/expenses/${expenseId}`, { signal })).data.expense;

export const submitExpense = async (
  orgId: string,
  payload: {
    requestId?: string;
    receiptExtractions?: {extractionId: string; appliedFields: string[]}[];
    files?: {name:string;mime:string;data:string}[];
    title: string;
    amountCentavos: number;
    category: Expense["category"];
    incurredDate: string;
    description?: string;
    budgetId?: string;
    spaceId?: string;
    periodId?: string;
    receiptUrl?: string;
    vendorName?: string;
  },
  onUploadProgress?: (event: AxiosProgressEvent) => void
) =>
  (await API.post<{ expense: Expense }>(`/organizations/${orgId}/expenses`, payload, { onUploadProgress })).data.expense;

export const reviewExpense = async (
  orgId: string,
  expenseId: string,
  payload: { decision: "verified" | "approved" | "rejected"; expectedRevision: number; notes?: string }
) =>
  (await API.post<{ review: { id: string; status: string } }>(`/organizations/${orgId}/expenses/${expenseId}/review`, payload)).data.review;

export const getCashAdvances = async (orgId: string, filters?: { status?: string; spaceId?: string; periodId?: string }, request?: FinancialReadRequest) => {
  const params = new URLSearchParams();
  if (filters?.spaceId) params.set("spaceId", filters.spaceId);
  if (filters?.periodId) params.set("periodId", filters.periodId);
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return (await API.get<{ advances: CashAdvance[] }>(`/organizations/${orgId}/advances${qs}`, request)).data.advances;
};

export const getCashAdvance = async (orgId: string, advanceId: string, signal?: AbortSignal) =>
  (await API.get<{ advance: CashAdvance }>(`/organizations/${orgId}/advances/${advanceId}`, { signal })).data.advance;

export const createCashAdvance = async (
  orgId: string,
  payload: {
    accountablePersonId: string;
    title: string;
    purpose: string;
    amountCentavos: number;
    disbursementMethod: CashAdvance["disbursement_method"];
    referenceNumber?: string;
    budgetId?: string;
    spaceId?: string;
    periodId?: string;
  }
) =>
  (await API.post<{ advance: CashAdvance }>(`/organizations/${orgId}/advances`, payload)).data.advance;

export const submitLiquidation = async (
  orgId: string,
  payload: {
    cashAdvanceId: string;
    spentCentavos: number;
    returnedCentavos: number;
    notes?: string;
  }
) =>
  (await API.post<{ liquidation: Liquidation }>(`/organizations/${orgId}/liquidations`, payload)).data.liquidation;

export const reviewLiquidation = async (
  orgId: string,
  liquidationId: string,
  payload: { decision: "approved" | "rejected"; notes?: string }
) =>
  (await API.post<{ review: { id: string; status: string } }>(`/organizations/${orgId}/liquidations/${liquidationId}/review`, payload)).data.review;

export const getAuditLogs = async (orgId: string, limit = 50, offset = 0) =>
  (await API.get<{ auditLogs: AuditLog[] }>(`/organizations/${orgId}/audit-logs?limit=${limit}&offset=${offset}`)).data.auditLogs;

export type LiquidationResolutionKind = "recovery" | "write_off" | "excess_return";
export interface LiquidationAllocation {
  expense_id: string;
  amount_centavos: number;
  attributed_budget_id?: string;
}

export const getLiquidationAccounting = async (org: string, liquidation: string) =>
  (await API.get<{
    review: { confirmed_at: string; payload: LiquidationAllocation[]; reason: string } | null;
    entries: { id: string; kind: LiquidationResolutionKind; amount_centavos: number; reverses: string | null; reason: string }[];
  }>(`/organizations/${org}/liquidations/${liquidation}/reconciliation`)).data;

export const confirmLiquidationAccounting = async (org: string, liquidation: string, input: { links: LiquidationAllocation[]; reason: string }) =>
  API.post(`/organizations/${org}/liquidations/${liquidation}/reconciliation`, input);

export const recordLiquidationResolution = async (org: string, liquidation: string, input: {
  request_id: string; entry_kind: LiquidationResolutionKind; amount: number; reason: string; reversal?: string;
}) => API.post(`/organizations/${org}/liquidations/${liquidation}/resolutions`, input);

export const getFinancialSummary = async (orgId: string, params?: { periodId?: string; spaceId?: string }, request?: FinancialReadRequest) =>
  (await API.get<{ summary: FinancialSummary }>(`/organizations/${orgId}/summary`, { ...request, params })).data.summary;

// ----------------------------------------------------
// EDIT & DELETE MUTATION APIS
// ----------------------------------------------------
export const updateSpace = async (
  orgId: string,
  spaceId: string,
  payload: { name: string; description?: string; status?: "active" | "archived" }
) =>
  (await API.patch<{ space: Space }>(`/organizations/${orgId}/spaces/${spaceId}`, payload)).data.space;

export const deleteSpace = async (orgId: string, spaceId: string) =>
  (await API.delete<{ id: string; action: string; message: string }>(`/organizations/${orgId}/spaces/${spaceId}`)).data;

export const updateCollection = async (
  orgId: string,
  collectionId: string,
  payload: {
    title: string;
    description?: string;
    targetCentavos?: number;
    dueDate?: string;
    spaceId?: string;
    status?: "active" | "closed" | "archived";
  }
) =>
  (await API.patch<{ collection: Collection }>(`/organizations/${orgId}/collections/${collectionId}`, payload)).data.collection;

export const deleteCollection = async (orgId: string, collectionId: string, confirmation: string) =>
  (await API.delete<{ id: string; action: string; message: string }>(`/organizations/${orgId}/collections/${collectionId}`, { data: { confirmation } })).data;

export const updateBudget = async (
  orgId: string,
  budgetId: string,
  payload: {
    name: string;
    allocatedCentavos: number;
    description?: string;
    spaceId?: string;
    periodId?: string;
    status?: "active" | "closed" | "archived";
  }
) =>
  (await API.patch<{ budget: Budget }>(`/organizations/${orgId}/budgets/${budgetId}`, payload)).data.budget;

export const deleteBudget = async (orgId: string, budgetId: string) =>
  (await API.delete<{ id: string; action: string; message: string }>(`/organizations/${orgId}/budgets/${budgetId}`)).data;

export const updateExpense = async (
  orgId: string,
  expenseId: string,
  payload: {
    title: string;
    amountCentavos: number;
    category: Expense["category"];
    incurredDate: string;
    description?: string;
    budgetId?: string;
    spaceId?: string;
    periodId?: string;
    receiptUrl?: string;
    vendorName?: string;
  }
) =>
  (await API.patch<{ expense: Expense }>(`/organizations/${orgId}/expenses/${expenseId}`, payload)).data.expense;

export const deleteExpense = async (orgId: string, expenseId: string) =>
  (await API.delete<{ id: string; action: string; message: string }>(`/organizations/${orgId}/expenses/${expenseId}`)).data;

export const updateCashAdvance = async (
  orgId: string,
  advanceId: string,
  payload: {
    title: string;
    purpose: string;
    amountCentavos: number;
    disbursementMethod: CashAdvance["disbursement_method"];
    referenceNumber?: string;
    budgetId?: string;
    spaceId?: string;
    periodId?: string;
  }
) =>
  (await API.patch<{ advance: CashAdvance }>(`/organizations/${orgId}/advances/${advanceId}`, payload)).data.advance;

export const deleteCashAdvance = async (orgId: string, advanceId: string) =>
  (await API.delete<{ id: string; action: string; message: string }>(`/organizations/${orgId}/advances/${advanceId}`)).data;

export const deleteLiquidation = async (orgId: string, liquidationId: string) =>
  (await API.delete<{ id: string; action: string; message: string }>(`/organizations/${orgId}/liquidations/${liquidationId}`)).data;

export interface AIConversation {
  id: string;
  organization_id: string;
  created_by: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AIMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: unknown;
  tool_results?: { tool: string; result: unknown }[];
  created_at: string;
}

export interface BaniRequestScope {
  userId: string;
  signal: AbortSignal;
}

export interface BaniNavigationPage {
  pathname: string;
  search: string;
}

export interface BaniNavigationTarget {
  destination: string;
  record?: string;
  space?: string;
}

export interface BaniFollowUpInput {
  id: string;
  collectionId?: string;
}

async function baniRequestConfig({ userId, signal }: BaniRequestScope) {
  const session = await resolveSafeSession(supabase.auth);
  signal.throwIfAborted();
  const user = session?.user;
  if (!session || typeof user !== "object" || !user || !("id" in user) || user.id !== userId) {
    throw new Error("Your Bani session has changed.");
  }
  return { signal, headers: { Authorization: `Bearer ${session.access_token}` } };
}

export const resolveBaniNavigation = async (orgId: string, target: BaniNavigationTarget, scope: BaniRequestScope) =>
  (await API.post<{ path: string; form?: "new_expense" }>(
    `/organizations/${orgId}/ai/navigation/resolve`, target, await baniRequestConfig(scope),
  )).data;

export const getAIConversations = async (orgId: string, scope: BaniRequestScope) =>
  (await API.get<{ conversations: AIConversation[] }>(`/organizations/${orgId}/ai/conversations`, await baniRequestConfig(scope))).data.conversations;

export const createAIConversation = async (orgId: string, title: string, scope: BaniRequestScope) =>
  (await API.post<{ conversation: AIConversation }>(`/organizations/${orgId}/ai/conversations`, { title }, await baniRequestConfig(scope))).data.conversation;

export const getAIConversation = async (
  orgId: string, conversationId: string, scope: BaniRequestScope,
  before?: Pick<AIMessage, "id" | "created_at">,
) => (await API.get<{ conversation: AIConversation; messages: AIMessage[]; hasOlder: boolean }>(
  `/organizations/${orgId}/ai/conversations/${conversationId}`,
  { ...await baniRequestConfig(scope), params: before && { before: before.created_at, beforeId: before.id } },
)).data;

export const renameAIConversation = async (orgId: string, conversationId: string, title: string, scope: BaniRequestScope) =>
  (await API.patch<{ title: string }>(`/organizations/${orgId}/ai/conversations/${conversationId}`, { title }, await baniRequestConfig(scope))).data.title;

export const deleteAIConversation = async (orgId: string, conversationId: string, scope: BaniRequestScope) =>
  (await API.delete<{ success: boolean }>(`/organizations/${orgId}/ai/conversations/${conversationId}`, await baniRequestConfig(scope))).data;

export async function streamAIChat(
  orgId: string,
  conversationId: string,
  prompt: string,
  callbacks: {
    onDelta: (text: string) => void;
    onToolStart?: (toolName: string, detail?: string) => void;
    onToolResult?: (toolName: string, result: unknown) => void;
    onDone?: () => void;
    onError?: (error: string, code?: string) => void;
  },
  scope: BaniRequestScope,
  insightId?: string,
  navigationPage?: BaniNavigationPage,
  action?: BaniFollowUpInput,
  receipt?: { extractionId: string; name: string },
  image?: { imageId: string; name: string },
) {
  const { headers, signal } = await baniRequestConfig(scope);
  const baseUrl = String(API.defaults.baseURL || "").replace(/\/+$/, "");

  const response = await fetch(`${baseUrl}/organizations/${orgId}/ai/conversations/${conversationId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ prompt, insightId, navigationPage, action, receipt, image }),
    signal,
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("Bani could not connect to the backend. Check the API address, backend availability, and allowed frontend origin.");
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    if (response.status === 401) {
      await clearRejectedBrowserSession(headers.Authorization.slice("Bearer ".length), errBody.code === "session_timed_out");
    }
    throw new ApiRequestError(errBody.message || `Request failed with status ${response.status}`, {
      status: response.status,
      code: typeof errBody.code === "string" ? errBody.code : undefined,
    });
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is not readable.");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === "[DONE]") {
        callbacks.onDone?.();
        return;
      }
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.type === "text_delta" && typeof parsed.data === "string") {
          callbacks.onDelta(parsed.data);
        } else if (parsed.type === "tool_start" && parsed.data?.tool) {
          callbacks.onToolStart?.(
            parsed.data.tool,
            typeof parsed.data.detail === "string" ? parsed.data.detail : undefined,
          );
        } else if (parsed.type === "tool_result" && parsed.data?.tool) {
          callbacks.onToolResult?.(parsed.data.tool, parsed.data.result);
        } else if (parsed.type === "error") {
          if (parsed.code === "session_timed_out") {
            await clearRejectedBrowserSession(headers.Authorization.slice("Bearer ".length), true);
            await reader.cancel();
            return;
          }
          callbacks.onError?.(parsed.data || "Unknown AI error", typeof parsed.code === "string" ? parsed.code : undefined);
        }
      } catch {
        // partial json, ignore
      }
    }
  }
}






export interface ExpensePolicy { expense_approval_policy: 'standard' | 'owner_admin_self' | 'strict'; treasurer_expense_approval: boolean; expense_policy_version: number }
export const getExpensePolicy = async (orgId: string) => (await API.get<{policy: ExpensePolicy}>(`/organizations/${orgId}/expense-policy`)).data.policy;
export const saveExpensePolicy = async (orgId: string, policy: string, treasurerApproval: boolean) => (await API.patch(`/organizations/${orgId}/expense-policy`, { policy, treasurerApproval })).data;

export const setMemberExpenseSubmission = async (orgId: string, memberId: string, allowed: boolean) => API.patch(`/organizations/${orgId}/members/${memberId}/expense-submission`, {allowed});


export const assignDirectoryObligations = async (orgId: string, collectionId: string, payload: {
  memberIds: string[]; amountCentavos: number; notes?: string;
}) => (await API.post<{ assigned: number }>(`/organizations/${orgId}/collections/${collectionId}/directory-obligations`, payload)).data;

export type DirectoryAssignmentMember = { id: string; display_name: string; member_code: string | null; attributes: Record<string, string | number | boolean> };

export const searchDirectoryForAssignment = async (
  orgId: string, params: { q: string; page: number; group?: string; attributeKey?: string; attributeValue?: string },
  signal: AbortSignal,
) => (await API.get<{ members: DirectoryAssignmentMember[]; total: number }>(
  `/organizations/${orgId}/directory`, { params: {...params,status:"active"}, signal },
)).data;

export async function getDirectoryAssignmentFilters(orgId: string, signal: AbortSignal) {
  const path = `/organizations/${orgId}/directory`;
  const [groups, fields] = await Promise.all([
    API.get<{ groups: { id: string; name: string }[] }>(path + "/groups", { signal }),
    API.get<{ fields: { key: string; label: string; kind: string; options: string[]; display_order?: number }[] }>(path + "/fields", { signal }),
  ]);
  return { groups: groups.data.groups, fields: fields.data.fields };
}

export const getObligationPage = async (orgId: string, collectionId: string, params: {page:number;q:string;status:string;obligationId?:string}, signal?:AbortSignal) =>
  (await API.get<{obligations:Obligation[];hasMore:boolean}>(`/organizations/${orgId}/collections/${collectionId}/obligations`,{params,signal})).data;

export type CollectionRosterRow = Omit<Obligation,"status"> & {
  status: Obligation["status"] | "not_assessed";
  obligation_id: string | null;
  directory_member_id: string | null;
  outside_scope: boolean;
  name: string;
};
export const getCollectionMembers = async (orgId:string,collectionId:string,params:{page:number;q:string;status:string;obligationId?:string} & CollectionAmountFilters,signal:AbortSignal) =>
  (await API.get<{rows:CollectionRosterRow[];hasMore:boolean;total:number;notAssessed:number;scope:string}>(`/organizations/${orgId}/collections/${collectionId}/members`,{params,signal})).data;

export const getFinancialInsights = async (orgId: string, request?: FinancialReadRequest) =>
  (await API.get<{ insights: { id: string; title: string; description: string; action: { label: string; href: string } }[]; evaluatedAt: string }>(
    `/organizations/${orgId}/insights`, request
  )).data;

export interface NotificationItem {
  id: string;
  recipient_user_id: string;
  organization_id: string | null;
  actor_user_id: string | null;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface PaginatedNotifications {
  items: NotificationItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const getNotifications = async (
  params: { limit?: number; offset?: number; unreadOnly?: boolean; organizationId?: string } = {},
  signal?: AbortSignal,
) =>
  (await API.get<PaginatedNotifications>("/notifications", { params, signal })).data;

export const getUnreadNotificationCount = async (organizationId?: string, signal?: AbortSignal) =>
  (
    await API.get<{ unreadCount: number }>("/notifications/unread-count", {
      params: organizationId ? { organizationId } : undefined,
      signal,
    })
  ).data;

export const markNotificationRead = async (notificationId: string) =>
  (await API.patch<{ notification: NotificationItem }>(`/notifications/${notificationId}/read`)).data;

export const markAllNotificationsRead = async (organizationId?: string) =>
  (
    await API.post<{ updatedCount: number }>(
      "/notifications/read-all",
      organizationId ? { organizationId } : {},
    )
  ).data;

export interface PendingWorkspaceInvitation {
  id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  created_at: string;
}

export const getPendingWorkspaceInvitations = async (signal?: AbortSignal) =>
  (await API.get<{ invitations: PendingWorkspaceInvitation[] }>("/notifications/invitations", { signal })).data;

export const respondToWorkspaceInvitation = async (invitationId: string, accept: boolean) =>
  (
    await API.post<{ invitation: { id: string; organization_id: string; status: string } }>(
      `/notifications/invitations/${invitationId}/respond`,
      { accept },
    )
  ).data;

export const inviteMemberByEmail = async (organizationId: string, email: string, role = "member") =>
  (
    await API.post<{ invitation: { id: string; organization_id: string; invited_email: string; role: string; status: string } }>(
      `/notifications/organizations/${organizationId}/invitations`,
      { email, role },
    )
  ).data;

export const triggerWorkspaceDueReminders = async (organizationId: string, daysAhead = 3) =>
  (
    await API.post<{ sentCount: number }>(
      `/notifications/organizations/${organizationId}/reminders`,
      { daysAhead },
    )
  ).data;

export interface PlatformAdminOverview {
  overview: {
    total_users: number;
    admin_count: number;
    super_admin_count: number;
    total_organizations: number;
    active_memberships: number;
    recent_audit_events_24h: number;
  };
  health: {
    status: string;
    uptimeSeconds: number;
    nodeEnv: string;
    dbStatus?: "ok" | "degraded";
    dbLatencyMs?: number;
  };
}

export interface PlatformAdminUser {
  id: string;
  email: string | null;
  username?: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: PlatformRole;
  created_at: string;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  organization_count: number;
  session_status: "logged_in" | "timed_out" | "logged_out";
  is_online?: boolean;
}

export interface PlatformAdminOrganization {
  id: string;
  name: string;
  organization_type: string | null;
  currency: string;
  time_zone: string | null;
  created_at: string;
  closed_at?: string | null;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  creator_id: string | null;
  creator_name: string | null;
  creator_email: string | null;
  active_member_count: number;
  open_incidents_count?: number;
  pending_approvals_count?: number;
}

export interface PlatformAdminAuditLog {
  id: number;
  organization_id: string | null;
  organization_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role?: PlatformRole | null;
  action: string;
  entity_id: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  occurred_at: string;
}

export const getPlatformAdminOverview = async () =>
  (await API.get<PlatformAdminOverview>("/admin/overview")).data;

export const listPlatformAdminUsers = async (params?: { q?: string; role?: PlatformRole; limit?: number; offset?: number }) =>
  (await API.get<{ users: PlatformAdminUser[]; total: number }>("/admin/users", { params })).data;

export const setPlatformAdminUserRole = async (userId: string, role: PlatformRole) =>
  (await API.patch<{ result: { id: string; previous_role: PlatformRole; role: PlatformRole } }>(`/admin/users/${userId}/role`, { role })).data.result;

export const listPlatformAdminOrganizations = async (params?: { q?: string; limit?: number; offset?: number }) =>
  (await API.get<{ organizations: PlatformAdminOrganization[]; total: number }>("/admin/organizations", { params })).data;

export const listPlatformAdminAuditLogs = async (params?: {
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) =>
  (await API.get<{ logs: PlatformAdminAuditLog[]; total: number }>("/admin/audit-logs", { params })).data;

export const exportPlatformAdminAuditLogsCsv = async (params?: { action?: string; from?: string; to?: string }) =>
  (await API.get<Blob>("/admin/audit-logs/export", { params, responseType: "blob" })).data;

export type SecurityCategory =
  | "auth"
  | "access_control"
  | "financial"
  | "api_abuse"
  | "data_protection"
  | "operational";
export type SecurityEventClass = "operational" | "security" | "audit";
export type SecuritySeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "resolved" | "false_positive";

export interface PlatformSecurityOverview {
  window_days: number;
  denied_403: number;
  rate_limited_429: number;
  errors_5xx: number;
  financial_blocked: number;
  high_critical_events: number;
  open_incidents: number;
  status_breakdown: {
    status_403: number;
    status_429: number;
    status_5xx: number;
  };
  category_breakdown: {
    auth: number;
    access_control: number;
    financial: number;
    api_abuse: number;
    data_protection: number;
    operational?: number;
  };
  burst_alerts: Array<{
    actor_id: string | null;
    actor_name: string | null;
    route: string;
    http_status: number;
    event_count: number;
    latest_at: string;
  }>;
  daily_trend: Array<{
    day: string;
    total: number;
    high_critical: number;
  }>;
}

export interface PlatformSecurityEvent {
  id: number;
  occurred_at: string;
  last_occurred_at?: string;
  occurrence_count?: number;
  category: SecurityCategory;
  event_class?: SecurityEventClass;
  event_source?: string;
  severity: SecuritySeverity;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  requesting_user_id?: string | null;
  requesting_user_name?: string | null;
  organization_id: string | null;
  organization_name: string | null;
  http_status: number | null;
  route: string | null;
  request_id: string | null;
  outcome: "blocked" | "denied" | "failed" | "flagged";
  classification_reason?: string | null;
  enforcement_eligible?: boolean;
  metadata: Record<string, unknown>;
}

export interface PlatformSecurityIncident {
  id: string;
  title: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  status: IncidentStatus;
  organization_id: string | null;
  organization_name: string | null;
  event_ids: number[];
  assigned_to: string | null;
  assigned_to_name: string | null;
  resolution_notes: string | null;
  detected_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface RealtimeVisitorsSnapshot {
  active_visitors: number;
  authenticated_visitors: number;
  anonymous_visitors: number;
  window_minutes: number;
  devices: {
    desktop: number;
    mobile: number;
    tablet: number;
  };
  top_pages: Array<{
    path: string;
    visitors: number;
  }>;
  recent_visitors: Array<{
    visitor_id: string;
    path: string;
    authenticated: boolean;
    device_type: "desktop" | "mobile" | "tablet";
    last_seen_at: string;
  }>;
  analytics_24h: {
    total_pageviews: number;
    unique_visitors: number;
    authenticated_share_pct: number;
    hourly_trend: Array<{
      hour: string;
      label: string;
      pageviews: number;
      unique_visitors: number;
    }>;
    top_pages: Array<{
      path: string;
      pageviews: number;
      unique_visitors: number;
    }>;
  };
  generated_at: string;
}

export const getPlatformRealtimeVisitors = async () =>
  (await API.get<{ realtime: RealtimeVisitorsSnapshot }>("/admin/realtime-visitors")).data;

export const getPlatformSecurityOverview = async (days = 7) =>
  (await API.get<{ overview: PlatformSecurityOverview }>("/admin/security/overview", { params: { days } })).data;

export const listPlatformSecurityEvents = async (params?: {
  category?: SecurityCategory;
  severity?: SecuritySeverity;
  eventClass?: SecurityEventClass;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) => (await API.get<{ events: PlatformSecurityEvent[]; total: number }>("/admin/security/events", { params })).data;

export const exportPlatformSecurityEventsCsv = async (params?: {
  category?: SecurityCategory;
  severity?: SecuritySeverity;
  from?: string;
  to?: string;
}) => (await API.get<Blob>("/admin/security/events/export", { params, responseType: "blob" })).data;

export const listPlatformSecurityIncidents = async (params?: {
  status?: IncidentStatus;
  severity?: SecuritySeverity;
  limit?: number;
  offset?: number;
}) => (await API.get<{ incidents: PlatformSecurityIncident[]; total: number }>("/admin/security/incidents", { params })).data;

export const createPlatformSecurityIncident = async (payload: {
  title: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  organizationId?: string;
  eventIds?: number[];
  notes?: string;
}) => (await API.post<{ incident: { id: string; status: "open" } }>("/admin/security/incidents", payload)).data;

export const updatePlatformSecurityIncident = async (
  incidentId: string,
  payload: { status: IncidentStatus; resolutionNotes?: string; assignedTo?: string },
) =>
  (
    await API.patch<{ incident: { id: string; status: IncidentStatus; resolved_at: string | null } }>(
      `/admin/security/incidents/${incidentId}`,
      payload,
    )
  ).data;

export interface PlatformFinancialCurrencySummary {
  currency: string;
  collected_centavos: number;
  budget_allocated_centavos: number;
  approved_expenses_centavos: number;
  pending_expenses_count: number;
  pending_expenses_centavos: number;
  open_advances_count: number;
  open_advances_centavos: number;
  disputed_advances_count: number;
}

export interface PlatformFinancialOverview {
  workspace_status: {
    active: number;
    suspended: number;
    closed: number;
  };
  by_currency: PlatformFinancialCurrencySummary[];
}

export interface PlatformFinancialAnomaly {
  organization_id: string;
  organization_name: string;
  currency: string;
  over_budget_count: number;
  disputed_advances_count: number;
  pending_expenses_count: number;
  reversed_payments_count: number;
}

export const setPlatformAdminUserSuspension = async (userId: string, suspended: boolean, reason?: string) =>
  (await API.patch<{ result: { user_id: string; suspended: boolean; reason: string | null } }>(
    `/admin/users/${userId}/suspension`,
    { suspended, reason },
  )).data;

export const setPlatformAdminOrgSuspension = async (organizationId: string, suspended: boolean, reason?: string) =>
  (await API.patch<{ result: { organization_id: string; suspended: boolean; reason: string | null } }>(
    `/admin/organizations/${organizationId}/suspension`,
    { suspended, reason },
  )).data;

export const getPlatformFinancialOverview = async () =>
  (await API.get<{ overview: PlatformFinancialOverview }>("/admin/financial/overview")).data;

export const listPlatformFinancialAnomalies = async () =>
  (await API.get<{ anomalies: PlatformFinancialAnomaly[] }>("/admin/financial/anomalies")).data;

export interface PlatformAttentionTrendPoint {
  day: string;
  audit_events: number;
  security_events: number;
}

export interface PlatformAttentionItem {
  type: "incident" | "financial_exception" | "suspended_user" | "suspended_workspace";
  id: string;
  title: string;
  subtitle: string;
  severity: "critical" | "high" | "medium" | "low";
}

export interface PlatformAttentionSummary {
  window_days: number;
  active_workspaces: number;
  open_security_alerts: number;
  financial_exceptions_count: number;
  suspended_accounts: number;
  suspended_workspaces: number;
  activity_trend: PlatformAttentionTrendPoint[];
  attention_items: PlatformAttentionItem[];
}

export interface PlatformWorkspace360 {
  workspace: {
    id: string;
    name: string;
    owner_user_id: string | null;
    member_count: number;
    created_at: string;
    closed_at: string | null;
    suspended_at: string | null;
    suspension_reason: string | null;
  };
  role_distribution: Array<{ role: string; count: number }>;
  financial_summary: {
    currency: string;
    collected_centavos: number;
    budget_allocated_centavos: number;
    approved_expenses_centavos: number;
    pending_approvals_count: number;
    open_advances_centavos: number;
    disputed_advances_count: number;
  };
  incidents: Array<{
    id: string;
    title: string;
    category: string;
    severity: string;
    status: string;
    created_at: string;
  }>;
  recent_audit_logs: Array<{
    id: string;
    action: string;
    target_type: string;
    actor_user_id: string | null;
    occurred_at: string;
  }>;
}

export interface PlatformFinancialCompliance {
  budget_compliance: Array<{
    organization_id: string;
    organization_name: string;
    currency: string;
    allocated_centavos: number;
    committed_centavos: number;
    utilization_pct: number;
  }>;
  approval_breakdown: {
    pending_count: number;
    verified_count: number;
    approved_count: number;
    rejected_count: number;
  };
  liquidation_aging: {
    bucket_0_7d: number;
    bucket_8_30d: number;
    bucket_30d_plus: number;
    disputed_count: number;
  };
}

export const getPlatformAttentionSummary = async (days: number = 7) =>
  (await API.get<{ summary: PlatformAttentionSummary }>("/admin/attention-summary", { params: { days } })).data;

export const getPlatformWorkspace360 = async (organizationId: string) =>
  (await API.get<{ workspace360: PlatformWorkspace360 }>(`/admin/organizations/${organizationId}/360`)).data;

export const getPlatformFinancialCompliance = async () =>
  (await API.get<{ compliance: PlatformFinancialCompliance }>("/admin/financial/compliance")).data;

export type EnforcementActionType =
  | "monitor"
  | "temp_ip_block"
  | "temp_account_lock"
  | "revoke_sessions"
  | "suspend_account"
  | "remove_restriction";

export interface PlatformThreatSource {
  source_ip: string;
  attempts: number;
  risk_score: number;
  risk_level: "critical" | "high" | "medium" | "low";
  last_detected: string;
  restriction_status: "monitoring" | "restricted" | "cleared" | "none";
  expires_at: string | null;
  reason: string | null;
}

export interface PlatformAccountLockout {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: PlatformRole;
  locked_until: string | null;
  lock_reason: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  sessions_revoked_at: string | null;
}

export interface PlatformEnforcementHistoryItem {
  id: string;
  action_type: EnforcementActionType;
  target_type: "ip" | "user";
  target_ip: string | null;
  target_user_id: string | null;
  target_name: string | null;
  duration_minutes: number | null;
  reason: string;
  actor_name: string | null;
  auto_triggered: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface PlatformThreatOverview {
  login_failures_hourly?: Array<{ start_at: string; failures: number }>;
  top_login_failure_ips?: Array<{ ip: string; failures: number; blocked: boolean }>;
  monitor_flags?: Array<{
    pattern: string;
    target: string;
    flag_day: string;
    detected_at: string;
    occurred_at: string | null;
    occurrences: number;
  }>;
  window_days: number;
  active_threats: number;
  blocked_requests: number;
  restricted_accounts: number;
  restricted_ips: number;
  unresolved_incidents: number;
  failed_auth_trend: Array<{
    day: string;
    failed_auth: number;
    blocked_requests: number;
  }>;
  activity_heatmap: Array<{
    dow: number;
    hour: number;
    count: number;
  }>;
  suspicious_sources: PlatformThreatSource[];
  account_lockouts: PlatformAccountLockout[];
  enforcement_history: PlatformEnforcementHistoryItem[];
}

export const getPlatformThreatOverview = async (days: number = 7) =>
  (await API.get<{ overview: PlatformThreatOverview }>("/admin/security/threats", { params: { days } })).data;

export const enforcePlatformAction = async (payload: {
  actionType: EnforcementActionType;
  reason: string;
  targetIp?: string;
  targetUserId?: string;
  durationMinutes?: number;
}) =>
  (
    await API.post<{
      result: { id: string; action_type: EnforcementActionType; target_type: "ip" | "user"; expires_at: string | null };
    }>("/admin/security/enforce", payload)
  ).data;

export interface PlatformAIOverview {
  days: number;
  summary: {
    total_requests: number;
    success_requests: number;
    error_requests: number;
    rate_limited_requests: number;
    aborted_requests: number;
    active_workspaces: number;
    active_users: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_tokens: number;
    avg_latency_ms: number;
    total_tool_calls: number;
    disabled_workspaces: number;
  };
  daily_series: Array<{
    date: string;
    requests: number;
    errors: number;
    rate_limited: number;
    tokens: number;
  }>;
  status_breakdown: Array<{
    status: string;
    count: number;
  }>;
  recent_errors: Array<{
    id: string;
    organization_id: string;
    organization_name: string | null;
    model: string;
    status: string;
    error_code: string | null;
    latency_ms: number;
    created_at: string;
  }>;
}

export interface PlatformAIWorkspaceUsage {
  organization_id: string;
  organization_name: string;
  ai_enabled: boolean;
  daily_request_limit: number;
  monthly_token_limit: number;
  daily_requests_used: number;
  monthly_tokens_used: number;
  period_requests: number;
  period_errors: number;
  period_rate_limited: number;
  period_tokens: number;
  avg_latency_ms: number;
  last_used_at: string | null;
}

export const getPlatformAIOverview = async (days: number = 7) =>
  (
    await API.get<{ overview: PlatformAIOverview }>("/admin/ai/overview", {
      params: { days, tzOffsetMinutes: -new Date().getTimezoneOffset() },
    })
  ).data;

export const listPlatformAIWorkspaces = async (params: { days?: number; q?: string; limit?: number } = {}) =>
  (await API.get<{ workspaces: PlatformAIWorkspaceUsage[] }>("/admin/ai/workspaces", { params })).data;

export const setPlatformWorkspaceAIQuota = async (
  organizationId: string,
  payload: {
    aiEnabled: boolean;
    dailyRequestLimit: number;
    monthlyTokenLimit: number;
    reason: string;
  },
) =>
  (await API.patch<{ quota: { ai_enabled: boolean; daily_request_limit: number; monthly_token_limit: number } }>(`/admin/ai/workspaces/${organizationId}/quota`, payload)).data;

export interface PlatformUserDetails {
  memberships: Array<{
    organization_id: string;
    organization_name: string;
    workspace_role: string;
    joined_at: string;
    suspended_at: string | null;
    closed_at: string | null;
  }>;
  role_history: Array<{
    id: string;
    action: string;
    before_value: Record<string, unknown> | null;
    after_value: Record<string, unknown> | null;
    created_at: string;
  }>;
  security_history: Array<{
    id: string;
    event_type: string;
    category: string;
    severity: string;
    source_ip: string | null;
    occurred_at: string;
  }>;
  enforcement_history: Array<{
    id: string;
    action_type: string;
    reason: string;
    expires_at: string | null;
    created_at: string;
  }>;
}

export const getPlatformUserDetails = async (userId: string) =>
  (await API.get<{ details: PlatformUserDetails }>(`/admin/users/${userId}/details`)).data;

export interface PlatformOrg360Extended {
  days: number;
  activity_series: Array<{
    date: string;
    audit_events: number;
    ai_requests: number;
    ai_tokens: number;
  }>;
  ai_summary: {
    ai_enabled: boolean;
    daily_request_limit: number;
    monthly_token_limit: number;
    daily_requests_used: number;
    monthly_tokens_used: number;
    period_requests: number;
    period_errors: number;
    period_rate_limited: number;
    period_tokens: number;
    avg_latency_ms: number;
  };
}

export const getPlatformOrg360Extended = async (organizationId: string, days: number = 30) =>
  (await API.get<{ extended: PlatformOrg360Extended }>(`/admin/organizations/${organizationId}/360/extended`, { params: { days } })).data;

export interface PlatformFinancialTrends {
  days: number;
  series: Array<{
    date: string;
    payment_count: number;
    collected_centavos: number;
    expense_count: number;
    approved_expenses_centavos: number;
  }>;
}

export const getPlatformFinancialTrends = async (days: number = 30) =>
  (await API.get<{ trends: PlatformFinancialTrends }>("/admin/financial/trends", { params: { days } })).data;

export const getPlatformSecurityHeatmap = async (params: {
  days?: number;
  startDate?: string;
  endDate?: string;
  tzOffsetMinutes?: number;
  eventType?: string;
}) =>
  (
    await API.get<{
      start_date: string;
      end_date: string;
      tz_offset_minutes: number;
      event_type: string | null;
      heatmap: Array<{ dow: number; hour: number; count: number }>;
    }>("/admin/security/heatmap", { params })
  ).data;

export interface PlatformSessionTimeoutSetting {
  idle_seconds: number;
  absolute_seconds: number;
  super_admin_exempt: boolean;
  updated_reason: string | null;
  updated_at: string | null;
}

export const getPlatformSessionTimeout = async () =>
  (await API.get<{ setting: PlatformSessionTimeoutSetting }>("/admin/settings/session-timeout")).data;

export const setPlatformSessionTimeout = async (payload: {
  idleSeconds: number;
  absoluteSeconds: number;
  superAdminExempt: boolean;
  reason: string;
}) =>
  (await API.patch<{ setting: PlatformSessionTimeoutSetting }>("/admin/settings/session-timeout", payload)).data;

export type OnboardingTourId = "org_overview" | "org_projects";
export type OnboardingTourStatus = "not_started" | "in_progress" | "completed" | "dismissed";

export interface OnboardingTourProgress {
  version: number;
  status: OnboardingTourStatus;
  step: number;
  updatedAt: string | null;
}

export type OnboardingChecklistTaskId =
  | "review_org_details"
  | "invite_teammate"
  | "create_collection_or_budget"
  | "create_project";

export interface OnboardingChecklistTask {
  id: OnboardingChecklistTaskId;
  title: string;
  description: string;
  completed: boolean;
  optional: boolean;
  actionHref: string;
  actionLabel: string;
}

export interface OrgOnboardingState {
  organizationId: string;
  role: string;
  checklist: {
    eligible: boolean;
    dismissed: boolean;
    completedAt: string | null;
    essentialCompleted: number;
    essentialTotal: number;
    allEssentialComplete: boolean;
    tasks: OnboardingChecklistTask[];
  };
  tours: Record<OnboardingTourId, OnboardingTourProgress>;
}

export const getOrgOnboarding = async (orgId: string, signal?: AbortSignal) =>
  (await API.get<{ onboarding: OrgOnboardingState }>(`/organizations/${orgId}/onboarding`, { signal })).data.onboarding;

export const updateOrgOnboarding = async (
  orgId: string,
  payload: {
    checklistDismissed?: boolean;
    markOrgDetailsReviewed?: boolean;
    tourUpdate?: {
      tourId: OnboardingTourId;
      version: number;
      status: OnboardingTourStatus;
      step?: number;
    };
  },
) =>
  (await API.patch<{ onboarding: OrgOnboardingState }>(`/organizations/${orgId}/onboarding`, payload)).data.onboarding;
