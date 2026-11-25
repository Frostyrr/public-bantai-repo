import Badge from "../ui/Badge";
import { useQuery } from '@tanstack/react-query';
import { useOutletContext, Link, useParams } from 'react-router-dom';
import { ArrowRight, Receipt, CheckCircle2, ShieldCheck } from 'lucide-react';
import {
  getUserObligations,
  type OrganizationDetails,
  type Membership,
} from '../../lib/api';
import { totalsByCurrency } from '../../utils/financialWorkflow';
import CompactAmount from '../ui/CompactAmount';
import FinancialQueryState from './FinancialQueryState';

export default function WorkspaceNextSteps() {
  const { orgId: routeOrgId } = useParams<{ orgId: string }>();
  const context = useOutletContext<{
    organization?: OrganizationDetails;
    membership?: Membership;
  }>();

  const organization = context?.organization;
  const membership = context?.membership;
  const orgId = organization?.id || routeOrgId;
  const role = membership?.role;

  const manager = role === 'owner' || role === 'organization_admin';
  const member = role === 'member' || role === 'student';

  const obligations = useQuery({
    queryKey: ['user-obligations'],
    queryFn: getUserObligations,
    enabled: Boolean(member),
  });

  if (member) {
    if (obligations.data === undefined) {
      return (
        <div className="rounded-3xl bg-surface border border-subtle p-6 shadow-xs dark:shadow-none">
          <FinancialQueryState queries={[obligations]} variant="compact" />
        </div>
      );
    }

    const own = (obligations.data ?? []).filter((o) => o.collections?.organization_id === orgId);
    const totals = totalsByCurrency(own);

    return (
      <div className="rounded-3xl bg-surface border border-subtle p-6 space-y-4 shadow-xs dark:shadow-xl hardware-sharp">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-elevated border border-subtle flex items-center justify-center text-secondary">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-heading font-medium text-primary">
                Your Contributions
              </h3>
              <p className="text-xs text-secondary">
                Personal dues &amp; receipts in this organization
              </p>
            </div>
          </div>

          <Link
            to={`/app/org/${orgId}/contributions`}
            className="text-xs font-mono text-secondary hover:text-primary hover:underline flex items-center gap-1 transition-colors"
          >
            View All <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Content Details */}
        {own.length === 0 ? (
          <div className="p-4 rounded-2xl bg-elevated border border-subtle text-center space-y-1.5">
            <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mx-auto">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <p className="text-xs text-primary font-medium">No dues assigned to you yet.</p>
            <p className="text-[11px] text-secondary">
              When fees or collection campaigns are assigned, they will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {totals.map((t) => (
              <div
                key={t.currency}
                className="p-3 rounded-2xl bg-elevated border border-subtle flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-mono text-xs uppercase tracking-wider text-primary">
                    {t.currency} Balance
                  </span>
                  <div className="text-[11px] text-secondary mt-0.5">
                    {t.outstanding > 0 ? "Pending payment" : "Fully settled"}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`font-mono font-medium ${
                      t.outstanding > 0 ? "text-amber-700 dark:text-amber-400 text-sm" : "text-emerald-700 dark:text-emerald-400 text-sm"
                    }`}
                  >
                    <CompactAmount centavos={t.outstanding} currency={t.currency} />
                  </div>
                  <Badge className="mt-0.5" >
                    {t.outstanding > 0 ? "Outstanding" : "Paid"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Action Link Button */}
        <div>
          <Link
            className="inline-flex items-center justify-center gap-2 w-full rounded-2xl border border-subtle bg-elevated hover:bg-surface hover:border-strong py-2.5 px-4 text-xs font-mono text-primary transition-all cursor-pointer"
            to={`/app/org/${orgId}/contributions`}
          >
            <span>View My Contributions &amp; Receipts</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  if (!manager && role) {
    const isAuditor = role === 'auditor';
    return (
      <div className="rounded-3xl bg-surface border border-subtle p-6 space-y-4 shadow-xs dark:shadow-xl hardware-sharp">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-elevated border border-subtle flex items-center justify-center text-secondary">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-heading font-medium text-primary">
                {isAuditor ? "Review Team Submissions" : "Officer Action Center"}
              </h3>
              <p className="text-xs text-secondary">
                {isAuditor ? "Independent compliance & approvals" : "Keep financial records up to date"}
              </p>
            </div>
          </div>

          <Link
            to={`/app/org/${orgId}/${isAuditor ? "approvals" : "collections"}`}
            className="text-xs font-mono text-secondary hover:text-primary hover:underline flex items-center gap-1 transition-colors"
          >
            Open <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <p className="text-xs text-secondary">
          {isAuditor
            ? "Verify supporting records before approving. Another officer must review your own submissions."
            : "Record member contributions, follow expense reviews, and reconcile outstanding cash advances."}
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Link
            className={`inline-flex items-center justify-center gap-1.5 flex-1 rounded-2xl border py-2.5 px-3 text-xs font-mono transition-all text-center ${
              isAuditor
                ? "border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-200"
                : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-200"
            }`}
            to={`/app/org/${orgId}/${isAuditor ? "approvals" : "collections"}`}
          >
            <span>{isAuditor ? "Open Review Queue" : "Record Collections"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            className="inline-flex items-center justify-center gap-1.5 flex-1 rounded-2xl border border-subtle bg-elevated hover:bg-surface text-primary py-2.5 px-3 text-xs font-mono transition-all text-center"
            to={`/app/org/${orgId}/liquidation`}
          >
            <span>Follow Advances</span>
          </Link>
        </div>
      </div>
    );
  }

  // Manager setup checklist is hosted in the sidebar carousel
  return null;
}
