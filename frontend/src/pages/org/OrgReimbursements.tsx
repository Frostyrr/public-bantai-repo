import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileText,
  HandCoins,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import DatePicker from "../../components/ui/DatePicker";
import Input from "../../components/ui/Input";
import Modal from "../../components/ui/Modal";
import Select from "../../components/ui/Select";
import ModuleEmptyState from "../../components/org/shared/ModuleEmptyState";
import ReceiptPreview from "../../components/org/expenses/ReceiptPreview";
import { KpiCardsSkeletonRow, SpecularTableSkeleton } from "../../components/layout/FinancialQueryState";
import { supabase } from "../../config/supabase";
import { encodeReceipt } from "../../utils/encodeFile";
import { getReportingPeriods, getSpaces, type Membership, type OrganizationDetails } from "../../lib/api";
import useFinancialQuery from "../../hooks/useFinancialQuery";

interface Claim {
  id: string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  incurredDate: string;
  claimant: string;
  claimantName: string | null;
  paymentId: string | null;
  paidOn: string | null;
}

const formatCurrency = (centavos: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(centavos / 100);

const money = (claim: Claim) => formatCurrency(claim.amount, claim.currency);
const dateToday = () => new Date().toLocaleDateString("en-CA");

function getClaimBadge(claim: Claim): { label: string; variant: "success" | "warning" | "danger" | "neutral" } {
  if (claim.paymentId) return { label: `Paid · ${claim.paidOn ?? ""}`.trim(), variant: "success" };
  if (claim.status === "approved") return { label: "Approved · Awaiting payment", variant: "warning" };
  if (["pending", "verified"].includes(claim.status)) return { label: "Pending review", variant: "neutral" };
  if (claim.status === "rejected") return { label: "Rejected", variant: "danger" };
  return { label: "Cancelled", variant: "neutral" };
}

export default function OrgReimbursements() {
  const context = useOutletContext<{
    organization: OrganizationDetails;
    membership: Membership;
    activePeriodId: string;
  }>();
  const { organization, membership } = context;
  return <ReimbursementWorkspace key={`${organization.id}:${membership.profile_id}:${membership.role}`} {...context} />;
}

function ReimbursementWorkspace({
  organization,
  membership,
  activePeriodId,
}: {
  organization: OrganizationDetails;
  membership: Membership;
  activePeriodId: string;
}) {
  const org = organization.id;
  const actor = membership.profile_id;
  const currency = organization.currency || "PHP";
  const canPay = membership.role === "owner" || membership.role === "treasurer";
  const canSubmit =
    membership.role !== "auditor" &&
    (!["member", "student"].includes(membership.role) || membership.can_submit_expenses === true);

  const client = useQueryClient();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [payment, setPayment] = useState<{ claim: Claim; id: string; correction: boolean } | null>(null);
  const [view, setView] = useState<"mine" | "unpaid" | "paid">("mine");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [claimDate, setClaimDate] = useState(dateToday());
  const [paidOnDate, setPaidOnDate] = useState(dateToday());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const claims = useQuery({
    queryKey: ["reimbursements", org, actor, membership.role],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_reimbursements", { org });
      if (error) throw new Error(error.message);
      return data as Claim[];
    },
  });

  const budgets = useFinancialQuery("budgets", org, {}, !!requestId);
  const projects = useQuery({
    queryKey: ["reimbursement-projects", org, actor],
    queryFn: () => getSpaces(org),
    enabled: !!requestId,
  });
  const periods = useQuery({
    queryKey: ["reimbursement-periods", org, actor],
    queryFn: () => getReportingPeriods(org),
    enabled: !!requestId,
  });

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (key: string) => String(form.get(key) ?? "").trim();
      setError("");
      if (payment) {
        const { error } = await supabase.rpc("settle_reimbursement", {
          org,
          claim: payment.claim.id,
          payment: payment.id,
          paid_on: value("paidOn") || null,
          method: value("method") || null,
          reference: value("reference") || null,
          void_reason: payment.correction ? value("reason") : null,
        });
        if (error) throw new Error(error.message);
        return;
      }
      const [whole, fraction = ""] = value("amount").split(".");
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(value("amount"))) {
        throw new Error("Enter a valid amount with up to two decimal places.");
      }
      const amountCentavos = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (amountCentavos <= 0) throw new Error("Enter a positive amount.");
      if (!selectedFiles.length || selectedFiles.length > 3 || selectedFiles.some(file => file.size > 1048576)) {
        throw new Error("Attach one to three receipts, each up to 1 MB.");
      }
      const { error } = await supabase.rpc("submit_reimbursement", {
        org,
        request_id: requestId,
        draft: {
          title: value("title"),
          amountCentavos,
          incurredDate: value("date"),
          category: "other",
          description: value("description"),
          budgetId: value("budget") || null,
          spaceId: value("project") || null,
          periodId: value("period") || null,
        },
        files: await Promise.all(selectedFiles.map(encodeReceipt)),
      });
      if (error) throw new Error(error.message);
    },
    onError: (failure) => setError(failure.message),
    onSuccess: async () => {
      setRequestId(null);
      setPayment(null);
      setSelectedFiles([]);
      await Promise.all(
        ["reimbursements", "expenses", "budgets", "financial-summary", "financial-insights"].map(key =>
          client.invalidateQueries({ queryKey: [key, org] })
        )
      );
    },
  });

  const allClaims = claims.data ?? [];
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const rows = allClaims.filter(claim => {
    const matchesTab =
      view === "mine" || !canPay
        ? claim.claimant === actor
        : view === "paid"
          ? Boolean(claim.paymentId)
          : claim.status === "approved" && !claim.paymentId;
    if (!matchesTab) return false;
    if (!normalizedSearch) return true;
    return (
      claim.title.toLowerCase().includes(normalizedSearch) ||
      (claim.claimantName ?? "").toLowerCase().includes(normalizedSearch) ||
      claim.status.toLowerCase().includes(normalizedSearch)
    );
  });

  const myCount = allClaims.filter(c => c.claimant === actor).length;
  const awaitingPayment = allClaims.filter(c => c.status === "approved" && !c.paymentId);
  const paidClaims = allClaims.filter(c => Boolean(c.paymentId));
  const awaitingTotal = awaitingPayment.reduce((sum, c) => sum + c.amount, 0);
  const paidTotal = paidClaims.reduce((sum, c) => sum + c.amount, 0);

  const close = () => {
    if (!save.isPending) {
      setRequestId(null);
      setPayment(null);
      setSelectedFiles([]);
    }
  };

  const openNewClaim = () => {
    setError("");
    setClaimDate(dateToday());
    setSelectedFiles([]);
    setRequestId(crypto.randomUUID());
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList).filter(file => file.size > 0);
    setSelectedFiles(existing => [...existing, ...incoming].slice(0, 3));
  };

  return (
    <main className="page-shell workspace-page space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">
            <span className="text-display-gradient">Reimbursements</span>
          </h1>
          <p className="page-subtitle">
            Submit receipts for out-of-pocket purchases and track repayment.
          </p>
        </div>
        {canSubmit && (
          <Button icon={<Plus className="size-4" aria-hidden="true" />} onClick={openNewClaim}>
            Submit claim
          </Button>
        )}
      </header>

      {claims.isPending ? (
        <div className="space-y-6 skeleton-shimmer">
          <KpiCardsSkeletonRow count={3} />
          <SpecularTableSkeleton rows={4} cols={4} />
        </div>
      ) : claims.isError ? (
        <div role="alert" className="rounded-2xl border border-sem-error-border bg-sem-error-bg p-5 text-sm text-sem-error-fg">
          {claims.error.message}
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="card-specular rounded-2xl border border-subtle bg-surface p-4">
              <div className="flex items-center justify-between text-xs text-secondary">
                <span className="font-mono uppercase tracking-wider text-[11px]">My Claims</span>
                <HandCoins className="size-4 text-muted" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-primary">{myCount}</p>
              <p className="mt-1 text-xs text-secondary">Submitted by you</p>
            </div>

            <div className="card-specular rounded-2xl border border-subtle bg-surface p-4">
              <div className="flex items-center justify-between text-xs text-secondary">
                <span className="font-mono uppercase tracking-wider text-[11px]">Awaiting Payment</span>
                <Clock className="size-4 text-sem-warning-fg" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-primary">
                {formatCurrency(awaitingTotal, currency)}
              </p>
              <p className="mt-1 text-xs text-secondary">
                {awaitingPayment.length} approved {awaitingPayment.length === 1 ? "claim" : "claims"}
              </p>
            </div>

            <div className="card-specular rounded-2xl border border-subtle bg-surface p-4">
              <div className="flex items-center justify-between text-xs text-secondary">
                <span className="font-mono uppercase tracking-wider text-[11px]">Total Repaid</span>
                <CheckCircle2 className="size-4 text-sem-success-fg" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-primary">
                {formatCurrency(paidTotal, currency)}
              </p>
              <p className="mt-1 text-xs text-secondary">
                {paidClaims.length} settled {paidClaims.length === 1 ? "claim" : "claims"}
              </p>
            </div>
          </section>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search claims by title or member…"
                  aria-label="Search reimbursement claims"
                  className="w-full rounded-xl border border-subtle bg-surface py-2 pl-10 pr-9 text-sm text-primary placeholder:text-muted transition-colors focus:border-strong focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-muted hover:text-primary"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              <div
                role="group"
                aria-label="Filter reimbursement claims"
                className="inline-flex flex-wrap items-center gap-1 self-start rounded-xl border border-subtle bg-secondary-surface p-1 sm:self-auto"
              >
                {(
                  [
                    ["mine", "My claims", myCount],
                    ...(canPay
                      ? [
                          ["unpaid", "Awaiting payment", awaitingPayment.length] as const,
                          ["paid", "Paid claims", paidClaims.length] as const,
                        ]
                      : []),
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      view === key
                        ? "bg-selected-surface text-primary shadow-xs dark:shadow-none"
                        : "text-secondary hover:text-primary"
                    }`}
                  >
                    <span>{label}</span>
                    <span className="rounded-md bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-secondary tabular-nums">
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Link
              to="../approvals"
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-subtle bg-surface px-3 py-2 text-xs font-medium text-secondary transition-colors hover:border-strong hover:text-primary lg:self-auto"
            >
              <span>Review in Approvals</span>
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>

          {!rows.length ? (
            <ModuleEmptyState>
              <div className="flex items-center justify-center border border-subtle bg-elevated text-secondary">
                <HandCoins className="size-6" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold text-primary">
                {normalizedSearch
                  ? "No matching reimbursement claims"
                  : view === "unpaid"
                    ? "No approved claims awaiting payment"
                    : view === "paid"
                      ? "No paid reimbursement claims yet"
                      : "No reimbursement claims yet"}
              </h2>
              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-secondary">
                {normalizedSearch
                  ? `No claims matched "${searchQuery.trim()}". Try another search or clear the filter.`
                  : view === "mine"
                    ? "Submit a receipt for an out-of-pocket organization purchase to start tracking repayment."
                    : "Claims appear here as officers approve and settle them."}
              </p>
              {normalizedSearch ? (
                <Button size="sm" variant="outline" onClick={() => setSearchQuery("")} className="mt-5">
                  Clear search
                </Button>
              ) : (
                canSubmit &&
                view === "mine" && (
                  <Button
                    size="sm"
                    icon={<Plus className="size-3.5" aria-hidden="true" />}
                    onClick={openNewClaim}
                    className="mt-5"
                  >
                    Submit claim
                  </Button>
                )
              )}
            </ModuleEmptyState>
          ) : (
            <div className="space-y-3">
              {rows.map(claim => {
                const badge = getClaimBadge(claim);
                return (
                  <article
                    key={claim.id}
                    className="card-specular-interactive flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-subtle bg-surface p-4 sm:p-5"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-medium text-primary">{claim.title}</h2>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <p className="text-xs text-secondary">
                        {claim.claimantName || "Member"} &middot; Incurred {claim.incurredDate}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-base font-semibold tabular-nums text-primary">
                        {money(claim)}
                      </span>
                      {canPay && claim.status === "approved" && (
                        <Button
                          size="sm"
                          variant={claim.paymentId ? "ghost" : "outline"}
                          onClick={() => {
                            setError("");
                            setPaidOnDate(dateToday());
                            setPayment({
                              claim,
                              id: claim.paymentId ?? crypto.randomUUID(),
                              correction: !!claim.paymentId,
                            });
                          }}
                        >
                          {claim.paymentId ? "Correct payment" : "Record payment"}
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal isOpen={!!requestId || !!payment} onClose={close} maxWidth="max-w-lg">
        <form
          onSubmit={event => {
            event.preventDefault();
            save.mutate(new FormData(event.currentTarget));
          }}
          className="space-y-4"
        >
          <div className="flex items-start justify-between gap-3 border-b border-subtle pb-3">
            <div>
              <h2 className="text-xl font-semibold text-primary">
                {payment
                  ? payment.correction
                    ? "Void payment record"
                    : "Record payment"
                  : "Submit reimbursement claim"}
              </h2>
              {payment && (
                <p className="mt-1 text-xs text-secondary">
                  {payment.claim.claimantName || "Member"} &middot; {money(payment.claim)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              disabled={save.isPending}
              aria-label="Close modal"
              className="grid size-8 cursor-pointer place-items-center rounded-lg text-secondary hover:bg-elevated hover:text-primary"
            >
              <X className="size-4" />
            </button>
          </div>

          {payment ? (
            payment.correction ? (
              <div className="space-y-3">
                <p className="rounded-xl border border-sem-warning-border bg-sem-warning-bg px-3 py-2 text-xs text-sem-warning-fg">
                  Void an incorrect record. This updates Bantai’s balances and does not return money.
                </p>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-secondary">Correction reason</label>
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={500}
                    required
                    rows={3}
                    placeholder="Explain why this payment record is being voided…"
                    className="w-full rounded-2xl border border-subtle bg-elevated p-3 text-sm text-primary placeholder:text-muted focus:border-strong focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-secondary">
                  Confirm the full amount has already been paid outside Bantai.
                </p>
                <DatePicker
                  label="Payment date"
                  name="paidOn"
                  min={payment.claim.incurredDate}
                  max={dateToday()}
                  value={paidOnDate}
                  onChange={setPaidOnDate}
                  allowClear={false}
                  required
                />
                <Select
                  label="Method"
                  name="method"
                  defaultValue="cash"
                  options={[
                    { value: "cash", label: "Cash" },
                    { value: "bank_transfer", label: "Bank transfer" },
                    { value: "e_wallet", label: "E-wallet" },
                    { value: "other", label: "Other" },
                  ]}
                />
                <Input
                  label="Reference (required for non-cash payments)"
                  name="reference"
                  maxLength={150}
                  placeholder="e.g. GCash ref #123456"
                />
              </div>
            )
          ) : (
            <div className="space-y-3.5">
              <Input
                label="Purchase title"
                name="title"
                required
                maxLength={200}
                placeholder="e.g. Event tarpaulin printing"
              />

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Input
                  label={`Amount (${currency})`}
                  name="amount"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                />
                <DatePicker
                  label="Purchase date"
                  name="date"
                  max={dateToday()}
                  value={claimDate}
                  onChange={setClaimDate}
                  allowClear={false}
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">Purpose</label>
                <textarea
                  name="description"
                  required
                  maxLength={1000}
                  rows={2}
                  placeholder="Explain what was purchased and why…"
                  className="w-full rounded-2xl border border-subtle bg-elevated p-3 text-sm text-primary placeholder:text-muted focus:border-strong focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Select
                  label="Project (Optional)"
                  name="project"
                  defaultValue=""
                  options={[
                    { value: "", label: "No project" },
                    ...(projects.data ?? []).map(project => ({ value: project.id, label: project.name })),
                  ]}
                />
                <Select
                  label="Reporting period (Optional)"
                  name="period"
                  key={periods.isSuccess ? activePeriodId : "loading"}
                  defaultValue={activePeriodId === "all" ? "" : activePeriodId}
                  options={[
                    { value: "", label: "No period" },
                    ...(periods.data ?? []).map(period => ({ value: period.id, label: period.name })),
                  ]}
                />
              </div>

              <Select
                label="Budget (Optional)"
                name="budget"
                defaultValue=""
                options={[
                  { value: "", label: "No budget" },
                  ...(budgets.data ?? [])
                    .filter(budget => budget.status === "active" && !budget.archived_at)
                    .map(budget => ({ value: budget.id, label: budget.name })),
                ]}
              />

              <div className="space-y-2">
                <span className="block text-xs font-medium text-secondary">Receipts (1–3 files, up to 1 MB each)</span>
                <label
                  htmlFor="reimbursement-receipts"
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
                    addFiles(event.dataTransfer.files);
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-strong bg-elevated/40 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-elevated/80"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-subtle bg-surface text-secondary">
                    <Upload size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-primary">Drop receipts or click to browse</span>
                    <span className="block text-xs text-secondary">JPG, PNG, WebP, or PDF</span>
                  </span>
                  <input
                    id="reimbursement-receipts"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    multiple
                    className="sr-only"
                    onChange={event => {
                      addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>

                {selectedFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {selectedFiles.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        className="flex items-center justify-between gap-2 rounded-xl border border-subtle bg-elevated/70 p-2"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-surface text-secondary">
                            {file.type.startsWith("image/") ? (
                              <ReceiptPreview file={file} name={file.name} />
                            ) : (
                              <FileText size={15} aria-hidden="true" />
                            )}
                          </div>
                          <span className="truncate text-xs font-medium text-primary" title={file.name}>
                            {file.name}
                          </span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedFiles(existing => existing.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-xl border border-sem-error-border bg-sem-error-bg px-3 py-2 text-xs text-sem-error-fg">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-subtle pt-3">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" isLoading={save.isPending}>
              {payment ? (payment.correction ? "Void record" : "Confirm payment") : "Submit claim"}
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
