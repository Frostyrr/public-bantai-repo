import { PersonalHeaderActions } from "../../components/layout/PersonalWorkspaceLayout";
import Badge from "../../components/ui/Badge";
import CompactAmount from "../../components/ui/CompactAmount";
import { useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Receipt,
  CheckCircle2,
  Clock,
  Printer,
  Copy,
  Check,
  Building2,
  ArrowRight,
  ArrowLeft,
  Search,
  Filter,
  CreditCard,
  Wallet,
  AlertCircle,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import Select from "../../components/ui/Select";
import { getOrganizations, getUserObligations, type Payment } from "../../lib/api";
import { totalsByCurrency } from "../../utils/financialWorkflow";
import { formatErrorMessage } from "../../utils/formatError";

function formatMoney(centavos: number, currency = "PHP") {
  const amount = (centavos / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

export default function PersonalPayments() {
  const location = useLocation();
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: getOrganizations,
  });
  const origin = location.state?.returnTo;
  const originPath = typeof origin === "string" ? origin.split(/[?#]/, 1)[0] : "";
  const originOrgId = originPath.match(/^\/app\/org\/([a-z0-9-]+)(?:\/[^?#]*)?$/i)?.[1];
  const originMembership = organizationsQuery.data?.find(
    membership => membership.organization_id === originOrgId,
  );
  const canReturnToOrg = Boolean(originOrgId && originMembership?.organizations);
  const returnTo = canReturnToOrg ? origin : "/dashboard";
  const returnLabel = canReturnToOrg
    ? `Back to ${originMembership?.organizations?.name}`
    : "Back to My Organizations";

  const [copiedReceipt, setCopiedReceipt] = useState<string | null>(null);
  const [searchReceiptQuery, setSearchReceiptQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [obligationStatusFilter, setObligationStatusFilter] = useState("all");

  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<{
    payment: Payment;
    orgName: string;
    collectionTitle: string;
    currency: string;
  } | null>(null);

  const obligationsQuery = useQuery({
    queryKey: ["user-obligations"],
    queryFn: getUserObligations,
  });

  const obligations = useMemo(
    () => obligationsQuery.data ?? [],
    [obligationsQuery.data]
  );

  // Flatten all payments from all obligations
  const paymentsList = useMemo(() => {
    const list: Array<{
      payment: Payment;
      orgName: string;
      collectionTitle: string;
      currency: string;
    }> = [];

    obligations.forEach((ob) => {
      const orgName = ob.collections?.organizations?.name || "Organization";
      const collectionTitle = ob.collections?.title || "Dues";
      const currency = ob.collections?.currency || "PHP";

      (ob.payments ?? []).forEach((p) => {
        list.push({
          payment: p,
          orgName,
          collectionTitle,
          currency,
        });
      });
    });

    // Sort payments by date descending
    list.sort(
      (a, b) =>
        new Date(b.payment.paid_at).getTime() -
        new Date(a.payment.paid_at).getTime()
    );

    return list;
  }, [obligations]);

  // Filtered obligations
  const filteredObligations = useMemo(() => {
    if (obligationStatusFilter === "all") return obligations;
    return obligations.filter((ob) => ob.status === obligationStatusFilter);
  }, [obligations, obligationStatusFilter]);

  // Filtered payments
  const filteredPayments = useMemo(() => {
    return paymentsList.filter((item) => {
      const matchesSearch =
        !searchReceiptQuery.trim() ||
        item.payment.receipt_number
          .toLowerCase()
          .includes(searchReceiptQuery.toLowerCase().trim()) ||
        item.collectionTitle
          .toLowerCase()
          .includes(searchReceiptQuery.toLowerCase().trim()) ||
        item.orgName
          .toLowerCase()
          .includes(searchReceiptQuery.toLowerCase().trim());

      const matchesMethod =
        methodFilter === "all" ||
        item.payment.payment_method.toLowerCase() === methodFilter.toLowerCase();

      return matchesSearch && matchesMethod;
    });
  }, [paymentsList, searchReceiptQuery, methodFilter]);

  const copyReceipt = (receipt: string) => {
    navigator.clipboard.writeText(receipt);
    setCopiedReceipt(receipt);
    setTimeout(() => setCopiedReceipt(null), 2000);
  };

  const currencyTotals = useMemo(() => totalsByCurrency(obligations), [obligations]);

  return (
    <div className="min-h-[calc(100dvh-var(--workspace-navbar-height,3.5rem))] bg-canvas text-primary flex flex-col font-body relative overflow-x-hidden select-none">
      {/* Ambient Radial Background Glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-cyan-500/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Top Navigation Bar with Unified Breadcrumb */}
      <PersonalHeaderActions loading={obligationsQuery.isPending} />

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 space-y-8 relative z-10">
        <Link
          to={returnTo}
          aria-busy={Boolean(originOrgId && organizationsQuery.isPending)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-400"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {originOrgId && organizationsQuery.isPending ? "Loading return destination…" : returnLabel}
        </Link>
        {/* Page Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge >
                Personal Ledger
              </Badge>
              <Badge >
                Cross-Organization Records
              </Badge>
            </div>
            <h1 className="text-[28px] md:text-[30px] leading-[1.2] tracking-[-0.02em]">
              <span className="text-display-gradient">Personal Ledger &amp; Receipts</span>
            </h1>
            <p className="text-secondary text-sm mt-1 max-w-2xl leading-relaxed">
              Consolidated contribution dues, settlement history, and authenticated electronic receipts across all your organization memberships.
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {obligationsQuery.error && (
          <div
            role="alert"
            className="p-5 rounded-2xl bg-sem-error-bg border border-sem-error-border text-sem-error-fg text-sm flex items-center justify-between gap-4 backdrop-blur-md"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-sem-error-fg shrink-0" />
              <p>{formatErrorMessage(obligationsQuery.error)}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void obligationsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Overview Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="p-5 sm:p-6 rounded-2xl bg-surface border border-subtle shadow-lg backdrop-blur-xl hardware-sharp relative overflow-hidden group hover:border-subtle transition-all">
            <div className="flex items-center justify-between text-secondary mb-2.5">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">
                Total Outstanding
              </span>
              <div className="w-7 h-7 rounded-lg bg-sem-warning-bg border border-sem-warning-border flex items-center justify-center text-sem-warning-fg">
                <Clock className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-mono font-medium text-sem-warning-fg tracking-tight">
              {obligationsQuery.isPending ? (
                <div className="h-8 w-36 rounded-md bg-skeleton animate-pulse motion-reduce:animate-none" />
              ) : currencyTotals.length ? (
                currencyTotals.map((t) => (
                  <span key={t.currency} className="block">
                    <CompactAmount centavos={t.outstanding} currency={t.currency} animate />
                  </span>
                ))
              ) : (
                <span className="text-muted text-xl font-normal">No dues</span>
              )}
            </div>
            <p className="text-xs text-muted mt-1 font-body">Pending settlement</p>
          </div>

          <div className="p-5 sm:p-6 rounded-2xl bg-surface border border-subtle shadow-lg backdrop-blur-xl hardware-sharp relative overflow-hidden group hover:border-subtle transition-all">
            <div className="flex items-center justify-between text-secondary mb-2.5">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">
                Total Contributed
              </span>
              <div className="w-7 h-7 rounded-lg bg-sem-success-bg border border-sem-success-border flex items-center justify-center text-sem-success-fg">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-mono font-medium text-sem-success-fg tracking-tight">
              {obligationsQuery.isPending ? (
                <div className="h-8 w-36 rounded-md bg-skeleton animate-pulse motion-reduce:animate-none" />
              ) : currencyTotals.length ? (
                currencyTotals.map((t) => (
                  <span key={t.currency} className="block">
                    <CompactAmount centavos={t.paid} currency={t.currency} animate />
                  </span>
                ))
              ) : (
                <span className="text-muted text-xl font-normal">
                  <CompactAmount centavos={0} currency="PHP" />
                </span>
              )}
            </div>
            <p className="text-xs text-muted mt-1 font-body">
              Paid across all organizations
            </p>
          </div>

          <div className="p-5 sm:p-6 rounded-2xl bg-surface border border-subtle shadow-lg backdrop-blur-xl hardware-sharp relative overflow-hidden group hover:border-subtle transition-all">
            <div className="flex items-center justify-between text-secondary mb-2.5">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">
                Issued Receipts
              </span>
              <div className="w-7 h-7 rounded-lg bg-skeleton border border-subtle flex items-center justify-center text-secondary">
                <Receipt className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-mono font-medium text-primary tracking-tight">
              {obligationsQuery.isPending ? (
                <div className="h-8 w-14 rounded-md bg-skeleton animate-pulse motion-reduce:animate-none" />
              ) : (
                paymentsList.length
              )}
            </div>
            <p className="text-xs text-muted mt-1 font-body">
              Official electronic receipts
            </p>
          </div>
        </div>

        {/* SECTION 1: ASSESSED OBLIGATIONS */}
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-skeleton/80 border border-subtle flex items-center justify-center text-secondary">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-heading font-medium text-primary tracking-tight">
                  Assessed Obligations
                </h2>
                <p className="text-xs text-muted font-mono">
                  Active assigned campaign dues across your workspaces
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={obligationStatusFilter}
                onChange={(e) => setObligationStatusFilter(e.target.value)}
                variant="pill"
                selectSize="sm"
                icon={<Filter className="w-3 h-3 text-secondary" />}
                menuWidth="auto"
                options={[
                  { value: "all", label: "All Statuses" },
                  { value: "pending", label: "Pending" },
                  { value: "partially_paid", label: "Partially Paid" },
                  { value: "paid", label: "Paid in Full" },
                  { value: "waived", label: "Waived" },
                ]}
              />
            </div>
          </div>

          {/* Skeletons while pending */}
          {obligationsQuery.isPending && (
            <div
              role="status"
              aria-label="Loading obligations"
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-pulse motion-reduce:animate-none"
            >
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-5 rounded-2xl bg-surface border border-subtle h-52 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <div className="w-24 h-4 rounded bg-skeleton" />
                      <div className="w-16 h-4 rounded-full bg-skeleton" />
                    </div>
                    <div className="w-36 h-5 rounded bg-skeleton" />
                  </div>
                  <div className="pt-3 border-t border-subtle/80 flex justify-between">
                    <div className="w-16 h-4 rounded bg-skeleton" />
                    <div className="w-20 h-4 rounded bg-skeleton" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty State */}
          {!obligationsQuery.isPending && filteredObligations.length === 0 && (
            <div className="p-10 rounded-2xl bg-surface border border-subtle text-center flex flex-col items-center backdrop-blur-md">
              <div className="w-12 h-12 rounded-2xl bg-secondary-surface border border-subtle flex items-center justify-center mb-3 text-sem-success-fg">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base sm:text-lg font-heading font-medium text-primary mb-1 tracking-tight">
                {obligationStatusFilter === "all"
                  ? "All obligations settled!"
                  : "No matching obligations found"}
              </h3>
              <p className="text-muted text-xs max-w-sm font-body">
                {obligationStatusFilter === "all"
                  ? "You have no outstanding payment obligations across any organization workspace."
                  : `No campaign obligations found under status "${obligationStatusFilter}".`}
              </p>
            </div>
          )}

          {/* Obligations Cards Grid */}
          {!obligationsQuery.isPending && filteredObligations.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredObligations.map((ob) => {
                const orgName = ob.collections?.organizations?.name || "Organization";
                const collTitle = ob.collections?.title || "Campaign";
                const currency = ob.collections?.currency || "PHP";
                const amount = ob.amount_centavos;
                const paid = ob.paid_centavos || 0;
                const balance = ob.remaining_centavos ?? Math.max(0, amount - paid);

                return (
                  <div
                    key={ob.id}
                    className="p-5 sm:p-6 rounded-2xl bg-surface border border-subtle hover:border-strong transition-all flex flex-col justify-between hardware-sharp shadow-lg backdrop-blur-xl group"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <Badge className="max-w-[170px]" >
                          <Building2 className="w-3 h-3 text-muted shrink-0" />
                          <span className="truncate">{orgName}</span>
                        </Badge>
                        <Badge >
                          {ob.status.replace("_", " ").toUpperCase()}
                        </Badge>
                      </div>

                      <h3 className="text-lg font-heading font-medium text-primary group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors truncate tracking-tight">
                        {collTitle}
                      </h3>

                      {ob.collections?.due_date && (
                        <p className="text-xs text-muted font-mono mt-1">
                          Due: {ob.collections.due_date}
                        </p>
                      )}

                      {/* Financial Figures */}
                      <div className="mt-4 pt-3.5 border-t border-subtle flex items-baseline justify-between">
                        <div>
                          <span className="text-[10px] font-mono text-muted uppercase tracking-wider block">
                            Assessed Dues
                          </span>
                          <span className="text-xs sm:text-sm font-mono text-secondary">
                            {formatMoney(amount, currency)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-mono text-muted uppercase tracking-wider block">
                            Remaining
                          </span>
                          <span
                            className={`text-sm sm:text-base font-mono font-medium ${
                              balance > 0 ? "text-sem-warning-fg" : "text-sem-success-fg"
                            }`}
                          >
                            {formatMoney(balance, currency)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {ob.collections?.organization_id && (
                      <div className="mt-4 pt-3.5 border-t border-subtle flex items-center justify-end">
                        <Link
                          to={`/app/org/${ob.collections.organization_id}/collections/${ob.collection_id}`}
                          className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors cursor-pointer group-hover:text-sem-success-fg"
                        >
                          <span>View Campaign Details</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* SECTION 2: DIGITAL RECEIPTS TABLE */}
        <div className="space-y-4 pt-6 border-t border-subtle">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-skeleton/80 border border-subtle flex items-center justify-center text-secondary">
                <Receipt className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-heading font-medium text-primary tracking-tight">
                  Official Electronic Receipts
                </h2>
                <p className="text-xs text-muted font-mono">
                  Immutable record of authorized payment settlements
                </p>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search receipt #, org, campaign…"
                  value={searchReceiptQuery}
                  onChange={(e) => setSearchReceiptQuery(e.target.value)}
                  className="bg-secondary-surface border border-subtle rounded-full pl-8 pr-3.5 py-1.5 text-xs text-primary placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors w-48 sm:w-60 font-body"
                />
              </div>

              <Select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                variant="pill"
                selectSize="sm"
                icon={<CreditCard className="w-3 h-3 text-secondary" />}
                menuWidth="auto"
                options={[
                  { value: "all", label: "All Methods" },
                  { value: "cash", label: "Cash" },
                  { value: "gcash", label: "GCash" },
                  { value: "maya", label: "Maya" },
                  { value: "bank_transfer", label: "Bank Transfer" },
                  { value: "other", label: "Other" },
                ]}
              />
            </div>
          </div>

          {/* Table Container */}
          {obligationsQuery.isPending ? (
            <div
              role="status"
              aria-label="Loading digital receipts"
              className="rounded-2xl bg-surface border border-subtle overflow-hidden shadow-xl backdrop-blur-xl hardware-sharp animate-pulse motion-reduce:animate-none"
            >
              <div className="border-b border-subtle bg-skeleton/40 px-5 py-3.5 grid grid-cols-6 gap-4">
                {[1, 2, 3, 4, 5, 6].map((col) => (
                  <div
                    key={col}
                    className={`h-3 rounded bg-skeleton ${
                      col === 3 || col === 6 ? "ml-auto w-16" : "w-20"
                    }`}
                  />
                ))}
              </div>
              <div className="divide-y divide-subtle/60">
                {[1, 2, 3].map((row) => (
                  <div
                    key={row}
                    className="px-5 py-3.5 grid grid-cols-6 gap-4 items-center"
                  >
                    <div className="h-3.5 w-24 rounded bg-skeleton" />
                    <div className="h-3.5 w-32 rounded bg-skeleton" />
                    <div className="h-3.5 w-20 rounded bg-skeleton ml-auto" />
                    <div className="h-5 w-16 rounded-full bg-skeleton" />
                    <div className="h-3.5 w-20 rounded bg-skeleton" />
                    <div className="h-7 w-24 rounded-lg bg-skeleton ml-auto" />
                  </div>
                ))}
              </div>
            </div>
          ) : paymentsList.length === 0 ? (
            <div className="p-10 rounded-2xl bg-surface border border-subtle text-center text-muted text-xs sm:text-sm backdrop-blur-md">
              No payments have been recorded for your personal account yet.
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="p-10 rounded-2xl bg-surface border border-subtle text-center text-muted text-xs sm:text-sm backdrop-blur-md">
              No receipts matched your search query.
            </div>
          ) : (
            <div className="rounded-2xl bg-surface border border-subtle overflow-hidden shadow-xl backdrop-blur-xl hardware-sharp">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-subtle bg-skeleton/40 text-[11px] font-mono uppercase tracking-wider text-secondary">
                      <th className="py-3.5 px-5">Receipt No.</th>
                      <th className="py-3.5 px-5">Organization &amp; Campaign</th>
                      <th className="py-3.5 px-5 text-right">Amount Settled</th>
                      <th className="py-3.5 px-5">Method</th>
                      <th className="py-3.5 px-5">Date</th>
                      <th className="py-3.5 px-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/70 text-xs sm:text-sm font-body">
                    {filteredPayments.map(
                      ({ payment, orgName, collectionTitle, currency }) => (
                        <tr
                          key={payment.id}
                          className="hover:bg-skeleton/40 transition-colors"
                        >
                          <td className="py-3.5 px-5 font-mono text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-primary tracking-wide">
                                {payment.receipt_number}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyReceipt(payment.receipt_number)}
                                className="p-1 rounded-md text-muted hover:text-primary hover:bg-secondary-surface transition-colors cursor-pointer"
                                title="Copy receipt number"
                              >
                                {copiedReceipt === payment.receipt_number ? (
                                  <Check className="w-3.5 h-3.5 text-sem-success-fg" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-3.5 px-5">
                            <div className="font-medium text-primary truncate max-w-xs">
                              {collectionTitle}
                            </div>
                            <div className="text-[11px] text-muted truncate max-w-xs font-mono">
                              {orgName}
                            </div>
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono font-medium text-sem-success-fg">
                            {formatMoney(payment.amount_centavos, currency)}
                          </td>
                          <td className="py-3.5 px-5">
                            <Badge >
                              {payment.payment_method.replace("_", " ")}
                            </Badge>
                          </td>
                          <td className="py-3.5 px-5 text-xs text-secondary font-mono">
                            {new Date(payment.paid_at).toLocaleDateString()}
                          </td>
                          <td className="py-3.5 px-5 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedReceiptPayment({
                                  payment,
                                  orgName,
                                  collectionTitle,
                                  currency,
                                })
                              }
                              className="px-3 py-1.5 rounded-full bg-skeleton hover:bg-secondary-surface border border-subtle hover:border-strong text-xs font-medium text-zinc-200 hover:text-primary transition-colors cursor-pointer"
                            >
                              View Receipt
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* RECEIPT VIEW MODAL */}
        {selectedReceiptPayment && (
          <Modal
            isOpen={!!selectedReceiptPayment}
            onClose={() => setSelectedReceiptPayment(null)}
            maxWidth="md"
          >
            <div className="text-center p-2">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950/60 border border-emerald-800/80 text-sem-success-fg flex items-center justify-center mx-auto mb-4">
                <Receipt className="w-6 h-6" />
              </div>

              <div className="flex items-center justify-center gap-2 mb-1">
                <Badge >
                  Official Electronic Receipt
                </Badge>
              </div>
              <h3 className="text-xl font-heading font-medium text-primary tracking-tight">
                Payment Record
              </h3>
              <p className="text-xs text-muted mb-6 font-body">
                Authenticated proof of settlement in Bantai
              </p>

              {/* Receipt Stub */}
              <div className="p-5 rounded-2xl bg-secondary-surface border border-subtle/90 text-left font-mono space-y-3 mb-6 hardware-sharp shadow-inner">
                <div className="flex items-center justify-between border-b border-subtle pb-2.5">
                  <span className="text-xs text-secondary">Receipt No.</span>
                  <span className="text-sm font-semibold text-primary tracking-wide">
                    {selectedReceiptPayment.payment.receipt_number}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary">Organization</span>
                  <span className="text-zinc-200">
                    {selectedReceiptPayment.orgName}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary">Campaign</span>
                  <span className="text-zinc-200 truncate max-w-[200px]">
                    {selectedReceiptPayment.collectionTitle}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary">Payment Method</span>
                  <span className="text-zinc-200 uppercase">
                    {selectedReceiptPayment.payment.payment_method.replace("_", " ")}
                  </span>
                </div>

                {selectedReceiptPayment.payment.reference_number && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-secondary">Reference No.</span>
                    <span className="text-zinc-200">
                      {selectedReceiptPayment.payment.reference_number}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary">Settled On</span>
                  <span className="text-zinc-200">
                    {new Date(
                      selectedReceiptPayment.payment.paid_at
                    ).toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-subtle pt-2.5 text-xs">
                  <span className="text-secondary">Total Settled</span>
                  <span className="text-base font-semibold text-sem-success-fg font-mono">
                    {formatMoney(
                      selectedReceiptPayment.payment.amount_centavos,
                      selectedReceiptPayment.currency
                    )}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.print()}
                  icon={<Printer className="w-3.5 h-3.5" />}
                >
                  Print Receipt
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setSelectedReceiptPayment(null)}
                >
                  Done
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </div>
  );
}
