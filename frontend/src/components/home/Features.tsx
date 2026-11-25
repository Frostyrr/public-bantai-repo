import { Banknote, ClipboardList, FolderKanban, Receipt, ShieldCheck, Users } from 'lucide-react';
import ScrollReveal from '../ui/ScrollReveal';

const features = [
  [Receipt, 'Collections & Membership Dues', 'Track member assessments, record batch or individual payments, and monitor remaining balances in real time.'],
  [FolderKanban, 'Budgets & Project Allocations', 'Partition funds across events, initiatives, and committees with live variance tracking before overspending occurs.'],
  [ClipboardList, 'Expense Approvals & Receipts', 'Submit itemized disbursements with supporting documentation and route them through structured officer review.'],
  [Banknote, 'Cash Advances & Liquidations', 'Release operational float to officers, track outstanding balances, and verify itemized liquidations cleanly.'],
  [ShieldCheck, 'Immutable Audit Trail', 'Every edit, approval, status change, and role update is logged automatically with actor timestamps for handover readiness.'],
  [Users, 'Role-Based Officer Access', 'Enforce strict separation of duties across Owners, Treasurers, Auditors, and Members within each workspace.'],
] as const;

export function Features() {
  return (
    <section id="features" tabIndex={-1} aria-labelledby="features-heading" className="mx-auto max-w-7xl">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <ScrollReveal direction="up" distance={10}>
          <h2 id="features-heading" className="max-w-2xl text-3xl sm:text-4xl md:text-[42px] leading-[1.12] tracking-[-0.025em]">
            <span className="text-display-gradient">Financial clarity, built for
            <br />every peso your org manages.</span>
          </h2>
        </ScrollReveal>
        <div className="mt-14 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([Icon, title, description], index) => (
            <ScrollReveal key={title} direction="up" distance={10} delay={index * 50}>
              <Icon className="mb-3.5 size-5 text-primary" aria-hidden="true" />
              <h3 className="mb-2 text-base font-medium text-primary">{title}</h3>
              <p className="text-sm leading-relaxed text-secondary">{description}</p>
            </ScrollReveal>
          ))}
        </div>
        <p className="mt-10 max-w-2xl text-sm leading-relaxed text-secondary">
          And when you need help understanding those records,{' '}
          <a href="#bani" className="rounded-sm text-primary underline decoration-muted underline-offset-4 transition-colors hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-4">ask Bani.</a>
        </p>
      </div>
    </section>
  );
}

export default Features;
