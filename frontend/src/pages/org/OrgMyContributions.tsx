import AnimatedNumber from "../../components/ui/AnimatedNumber";
import CompactAmount from "../../components/ui/CompactAmount";
import Badge from "../../components/ui/Badge";
import { useState } from "react";
import { Link, useLocation, useOutletContext, useParams } from "react-router-dom";
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
  ArrowUpRight,
  Wallet,
} from "lucide-react";
import Button from "../../components/ui/Button";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
} from "../../components/ui/DetailInspector";
import { getUserObligations, type Payment, type OrganizationDetails } from "../../lib/api";
import { totalsByCurrency } from "../../utils/financialWorkflow";
import FinancialQueryState from "../../components/layout/FinancialQueryState";

function formatMoney(centavos: number, currency = "PHP") {
  const amount = (centavos / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

export default function OrgMyContributions() {
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const context = useOutletContext<{ organization?: OrganizationDetails }>();
  const currentOrg = context?.organization;

  const [copiedReceipt, setCopiedReceipt] = useState<string | null>(null);
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

  const allObligations = obligationsQuery.data ?? [];
  // Filter obligations strictly to current organization
  const orgObligations = allObligations.filter(
    (ob) => ob.collections?.organization_id === orgId
  );

  // Flatten payments strictly for this organization
  const paymentsList: Array<{
    payment: Payment;
    orgName: string;
    collectionTitle: string;
    currency: string;
  }> = [];

  orgObligations.forEach((ob) => {
    const orgName = currentOrg?.name || ob.collections?.organizations?.name || "Organization";
    const collectionTitle = ob.collections?.title || "Dues";
    const currency = ob.collections?.currency || currentOrg?.currency || "PHP";

    (ob.payments ?? []).forEach((p) => {
      paymentsList.push({
        payment: p,
        orgName,
        collectionTitle,
        currency,
      });
    });
  });

  // Sort payments by date descending
  paymentsList.sort(
    (a, b) => new Date(b.payment.paid_at).getTime() - new Date(a.payment.paid_at).getTime()
  );

  const copyReceipt = (receipt: string) => {
    navigator.clipboard.writeText(receipt);
    setCopiedReceipt(receipt);
    setTimeout(() => setCopiedReceipt(null), 2000);
  };

  const currencyTotals = totalsByCurrency(orgObligations);

  return (
    <div className="page-shell workspace-page">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <Badge variant="context" className="page-header-eyebrow">
              <Building2 className="w-3 h-3" />
              {currentOrg?.name ?? "This Organization"}
            </Badge>
          </div>
          <h1 className="page-title">
            <span className="text-display-gradient">My Contributions</span>
          </h1>
          <p className="page-subtitle">
            Your assessed dues, payment records, and official electronic receipts for this organization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            to="/app/payments"
            state={{ returnTo: location.pathname + location.search + location.hash }}
            variant="glass"
            size="sm"
            iconRight={<ArrowUpRight className="w-3.5 h-3.5 text-secondary" />}
            className="text-xs font-mono"
            title="View personal ledger across all organizations"
          >
            Personal Ledger (All Orgs)
          </Button>
        </div>
      </div>

      {obligationsQuery.isPending || obligationsQuery.isError ? (
        <FinancialQueryState
          queries={[obligationsQuery]}
          variant="contributions"
          kpiCount={3}
          showFilterToolbar={false}
        />
      ) : (
        <>
      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Outstanding Dues */}
        <div className="card-specular p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">
              Outstanding Dues
            </span>
            <Clock className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary">
            {currencyTotals.length
              ? currencyTotals.map((t) => (
                  <span key={t.currency} className="block">
                    <CompactAmount centavos={t.outstanding} currency={t.currency} animate />
                  </span>
                ))
              : <CompactAmount centavos={0} currency={currentOrg?.currency || "PHP"} />}
          </p>
          <p className="text-xs text-secondary mt-1">Pending in this organization</p>
        </div>

        {/* Total Contributed */}
        <div className="card-specular p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">
              Total Contributed
            </span>
            <CheckCircle2 className="w-4 h-4 text-muted" />
          </div>
          <p className="metric-value text-primary">
            {currencyTotals.length
              ? currencyTotals.map((t) => (
                  <span key={t.currency} className="block">
                    <CompactAmount centavos={t.paid} currency={t.currency} animate />
                  </span>
                ))
              : <CompactAmount centavos={0} currency={currentOrg?.currency || "PHP"} />}
          </p>
          <p className="text-xs text-secondary mt-1">Recorded by organization treasurer</p>
        </div>

        {/* Issued Receipts */}
        <div className="card-specular p-5 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-secondary mb-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">
              Official Receipts
            </span>
            <Receipt className="w-4 h-4 text-secondary" />
          </div>
          <p className="metric-value text-primary">
            <AnimatedNumber value={paymentsList.length} />
          </p>
          <p className="text-xs text-secondary mt-1">Verified electronic receipts</p>
        </div>
      </div>

      {/* SECTION 1: ASSESSED OBLIGATIONS IN THIS ORG */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-secondary" />
            <h2 className="text-primary section-title">
              Assessed Dues &amp; Campaigns
            </h2>
          </div>
          <span className="text-xs font-mono text-secondary">
            {orgObligations.length} collection(s)
          </span>
        </div>

        {orgObligations.length === 0 ? (
          <div className="card-specular p-10 rounded-xl bg-surface border border-subtle text-center flex flex-col items-center shadow-xs dark:shadow-none">
            <div className="w-12 h-12 rounded-2xl bg-elevated border border-subtle flex items-center justify-center mb-3 text-secondary">
              <CheckCircle2 className="w-6 h-6 text-muted" />
            </div>
            <h3 className="text-lg font-heading font-medium text-primary mb-1 tracking-tight">
              No outstanding dues
            </h3>
            <p className="text-secondary text-xs max-w-sm leading-relaxed">
              You currently have no payment obligations assigned in {currentOrg?.name ?? "this organization"}.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orgObligations.map((ob) => {
              const collTitle = ob.collections?.title || "Campaign";
              const currency = ob.collections?.currency || currentOrg?.currency || "PHP";
              const amount = ob.amount_centavos;
              const paid = ob.paid_centavos || 0;
              const balance = ob.remaining_centavos ?? (amount - paid);

              return (
                <div
                  key={ob.id}
                  className="card-specular-interactive p-5 rounded-2xl sm:rounded-xl bg-surface border border-subtle flex flex-col justify-between hardware-sharp hover:border-strong transition-all shadow-xs dark:shadow-none"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <Badge >
                        Assessed Dues
                      </Badge>
                      <Badge >
                        {ob.status.replace("_", " ").toUpperCase()}
                      </Badge>
                    </div>

                    <h3 className="text-lg font-heading font-medium text-primary mt-1 tracking-tight">
                      {collTitle}
                    </h3>
                    {ob.collections?.due_date && (
                      <p className="text-xs text-secondary font-mono mt-1">
                        Due: {ob.collections.due_date}
                      </p>
                    )}

                    <div className="mt-4 pt-3 border-t border-subtle flex items-baseline justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-muted uppercase block">
                          Assessed
                        </span>
                        <span className="text-sm font-mono text-secondary">
                          {formatMoney(amount, currency)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-mono text-muted uppercase block">
                          Remaining
                        </span>
                        <span
                          className={`text-base font-mono font-medium ${
                            balance > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
                          }`}
                        >
                          {formatMoney(balance, currency)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {ob.collections?.organization_id && (
                    <div className="mt-4 pt-3 border-t border-subtle">
                      <Link
                        to={`/app/org/${ob.collections.organization_id}/collections/${ob.collection_id}`}
                        className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors"
                      >
                        <span>Campaign Overview</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: OFFICIAL RECEIPTS FOR THIS ORG */}
      <div className="space-y-4 pt-6 border-t border-subtle">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-secondary" />
            <h2 className="text-primary section-title">
              Official Electronic Receipts
            </h2>
          </div>
          <span className="text-xs font-mono text-secondary">
            {paymentsList.length} receipt(s)
          </span>
        </div>

        {paymentsList.length === 0 ? (
          <div className="card-specular p-8 rounded-xl bg-surface border border-subtle text-center text-secondary text-sm shadow-xs dark:shadow-none">
            No payments have been recorded for your account in this organization yet.
          </div>
        ) : (
          <div className="table-specular rounded-2xl sm:rounded-xl bg-surface border border-subtle overflow-hidden shadow-xs dark:shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-subtle bg-elevated text-[11px] font-mono uppercase tracking-wider text-muted">
                    <th className="py-4 px-6">Receipt No.</th>
                    <th className="py-4 px-6">Collection / Campaign</th>
                    <th className="py-4 px-6 text-right">Amount Settled</th>
                    <th className="py-4 px-6">Payment Method</th>
                    <th className="py-4 px-6">Date Paid</th>
                    <th className="py-4 px-6 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                  {paymentsList.map(({ payment, orgName, collectionTitle, currency }) => (
                    <tr key={payment.id} className="hover:bg-elevated/60 transition-colors">
                      <td className="py-4 px-6 font-mono text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-primary">
                            {payment.receipt_number}
                          </span>
                          <button
                            onClick={() => copyReceipt(payment.receipt_number)}
                            className="p-1 rounded text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
                            title="Copy receipt number"
                          >
                            {copiedReceipt === payment.receipt_number ? (
                              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-4 px-6 font-medium text-primary">
                        {collectionTitle}
                      </td>
                      <td className="py-4 px-6 text-right font-mono font-medium text-primary">
                        {formatMoney(payment.amount_centavos, currency)}
                      </td>
                      <td className="py-4 px-6">
                        <Badge >
                          {payment.payment_method.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-4 px-6 text-xs text-secondary font-mono">
                        {new Date(payment.paid_at).toLocaleDateString()}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() =>
                            setSelectedReceiptPayment({
                              payment,
                              orgName,
                              collectionTitle,
                              currency,
                            })
                          }
                          className="px-3 py-1.5 rounded-full bg-elevated hover:bg-surface border border-subtle text-xs font-medium text-secondary hover:text-primary transition-colors cursor-pointer"
                        >
                          View Receipt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {/* RECEIPT VIEW INSPECTOR */}
      <DetailInspector
        isOpen={Boolean(selectedReceiptPayment)}
        onClose={() => setSelectedReceiptPayment(null)}
        categoryLabel="Official Electronic Receipt"
        title={selectedReceiptPayment?.orgName ?? ""}
        subtitle={
          selectedReceiptPayment ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              VERIFIED &amp; RECORDED
            </span>
          ) : undefined
        }
        footer={
          selectedReceiptPayment ? (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                icon={<Printer className="w-3.5 h-3.5" />}
                className="flex-1 rounded-full"
              >
                Print Receipt
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setSelectedReceiptPayment(null)}
                className="flex-1 rounded-full"
              >
                Done
              </Button>
            </div>
          ) : undefined
        }
      >
        {selectedReceiptPayment && (
          <>
            <div className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.02] p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Receipt className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                    Receipt Number
                  </p>
                  <p className="font-mono text-xs text-primary font-medium truncate">
                    {selectedReceiptPayment.payment.receipt_number}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                  Amount Paid
                </p>
                <p className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatMoney(
                    selectedReceiptPayment.payment.amount_centavos,
                    selectedReceiptPayment.currency
                  )}
                </p>
              </div>
            </div>

            <InspectorGrid>
              <InspectorField
                label="Contribution"
                value={selectedReceiptPayment.collectionTitle}
                className="col-span-2"
              />
              <InspectorField
                label="Payment Method"
                value={selectedReceiptPayment.payment.payment_method.replace(
                  "_",
                  " "
                )}
              />
              <InspectorField
                label="Date Recorded"
                value={new Date(
                  selectedReceiptPayment.payment.paid_at
                ).toLocaleString()}
              />
              {selectedReceiptPayment.payment.reference_number && (
                <InspectorField
                  label="Reference No."
                  value={selectedReceiptPayment.payment.reference_number}
                  mono
                  className="col-span-2"
                />
              )}
            </InspectorGrid>
          </>
        )}
      </DetailInspector>
    </div>
  );
}
