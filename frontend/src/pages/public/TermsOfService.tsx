import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { legalDocumentPath, legalReturnLabel, legalReturnPath } from '../../lib/legalNavigation';
import { FileText, ChevronLeft, CheckCircle2, AlertTriangle, Users, Shield, HelpCircle } from 'lucide-react';
import Navbar from '../../components/layout/Navbar';
import Footer from '../../components/layout/Footer';
import background from '../../assets/bg.webp';

export const TermsOfService: React.FC = () => {
  const { search } = useLocation();
  const returnTo = legalReturnPath(search);
  const lastUpdated = 'November 12, 2026';

  const sections = [
    {
      id: 'acceptance',
      icon: <CheckCircle2 className="w-5 h-5 text-secondary shrink-0" />,
      title: '1. Acceptance of Terms',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            By creating an account, accessing, or using Bantai (&quot;the Service&quot;), you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree with any part of these Terms, you may not use the Service.
          </p>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            If you are using Bantai on behalf of an organization, student council, club, or association, you represent that you have the authority to act on behalf of that entity and bind it to these Terms.
          </p>
        </>
      ),
    },
    {
      id: 'accounts',
      icon: <Users className="w-5 h-5 text-secondary shrink-0" />,
      title: '2. User Accounts & Responsibilities',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            To use Bantai, you must register using a valid email address and choose a secure password, or authenticate using Google OAuth. You are responsible for maintaining the confidentiality of your login credentials and for all activities that take place under your account.
          </p>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            You must provide accurate, current, and complete information during registration and keep your account details up to date. Notify our team immediately if you suspect unauthorized access to your account.
          </p>
        </>
      ),
    },
    {
      id: 'governance',
      icon: <Shield className="w-5 h-5 text-secondary shrink-0" />,
      title: '3. Organization Workspaces & Officer Roles',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            Bantai provides structured multi-role organization workspaces designed around financial governance and accountability:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary text-sm sm:text-base leading-relaxed mb-3">
            <li>
              <strong className="text-primary">Owner &amp; Admin:</strong> Full administrative rights over organization settings, member invitations, and role assignments.
            </li>
            <li>
              <strong className="text-primary">Treasurer:</strong> Authorized to create budgets, record collections, submit expense requests, and submit cash advance liquidations.
            </li>
            <li>
              <strong className="text-primary">Auditor:</strong> Responsible for reviewing, approving, or requesting revisions on expense submissions and liquidations.
            </li>
            <li>
              <strong className="text-primary">Member:</strong> View-only access to organization financial balances, reports, and public receipts for transparency.
            </li>
          </ul>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            Organizations are solely responsible for assigning correct roles to appropriate officers. Bantai does not mediate disputes regarding internal organizational elections or leadership changes.
          </p>
        </>
      ),
    },
    {
      id: 'nature-of-service',
      icon: <AlertTriangle className="w-5 h-5 text-secondary shrink-0" />,
      title: '4. Scope & Financial Tool Disclaimer',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            Bantai is an internal accounting, record-keeping, and expense-approval platform designed to help teams maintain clear oversight of shared funds.
          </p>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            <strong className="text-primary">Bantai is not a bank</strong>, money transmitter, custodian, or financial depository. Bantai does not hold deposit accounts or process real currency settlement on behalf of users. All uploaded receipts, recorded budgets, dues, and approvals reflect internal records maintained by your organization officers.
          </p>
        </>
      ),
    },
    {
      id: 'acceptable-use',
      icon: <FileText className="w-5 h-5 text-secondary shrink-0" />,
      title: '5. Acceptable Use Policy',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            When using Bantai, you agree not to:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary text-sm sm:text-base leading-relaxed mb-3">
            <li>Upload fraudulent receipts, altered invoices, or knowingly fabricate financial transactions.</li>
            <li>Impersonate any person or officer, or falsely claim affiliation with an institution or organization.</li>
            <li>Attempt to probe, reverse-engineer, disrupt, or compromise the availability or security of the Service.</li>
            <li>Upload harmful files, viruses, or offensive media into expense attachments or profile banners.</li>
            <li>Use the platform for any illegal purpose under Philippine or applicable local laws.</li>
          </ul>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            We reserve the right to suspend or terminate accounts that violate this policy or engage in abusive behavior.
          </p>
        </>
      ),
    },
    {
      id: 'subscriptions',
      icon: <Users className="w-5 h-5 text-secondary shrink-0" />,
      title: '6. Free Tier & Subscription Plans',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            Bantai offers both Free and Paid tiers:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary text-sm sm:text-base leading-relaxed mb-3">
            <li>
              <strong className="text-primary">Free Tier:</strong> Includes creation of up to 5 organization workspaces, full two-officer approvals, member roles, collections, and standard audit logging.
            </li>
            <li>
              <strong className="text-primary">Paid Tier (PHP 250/month):</strong> Includes unlimited organization workspace creations, dedicated AI Financial Assistant, smart receipt anomaly detection, and priority support.
            </li>
          </ul>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            Subscription fees are billed on a recurring monthly basis. You can cancel your subscription at any time; your existing organizations and historical financial records remain intact and viewable.
          </p>
        </>
      ),
    },
    {
      id: 'termination',
      icon: <Shield className="w-5 h-5 text-secondary shrink-0" />,
      title: '7. Termination & Account Deletion',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            You may stop using Bantai at any time. Organization owners may delete or archive organization workspaces they control, provided all pending transactions are finalized or cleared.
          </p>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            Bantai reserves the right to suspend or terminate access for accounts that violate these Terms, remain inactive for extended durations, or create security risks for other users.
          </p>
        </>
      ),
    },
    {
      id: 'contact',
      icon: <HelpCircle className="w-5 h-5 text-secondary shrink-0" />,
      title: '8. Changes to Terms & Contact Information',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            We may update these Terms periodically to reflect product improvements, new features, or legal requirements. Material updates will be communicated through the platform or by email.
          </p>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            If you have questions regarding these Terms, please reach out to us through our{' '}
            <Link to="/contact" className="text-primary hover:opacity-80 underline underline-offset-2">
              Contact Page
            </Link>{' '}
            or email us directly at{' '}
            <a href="mailto:support@bantai.org" className="text-primary hover:underline">
              support@bantai.org
            </a>.
          </p>
        </>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-canvas text-primary dark:bg-[#050507] dark:text-white flex flex-col relative overflow-hidden hardware-sharp font-body font-normal">
      {/* Background Image Layer */}
      <div
        className="hidden dark:block absolute inset-0 bg-cover bg-center opacity-15 scale-105 pointer-events-none"
        style={{ backgroundImage: `url(${background})` }}
      />

      {/* Radial Blur & Subtle Ambient Lighting */}
      <div className="hidden dark:block absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_#050507_85%)] pointer-events-none" />
      <div className="hidden dark:block absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-zinc-800/15 rounded-full blur-[140px] pointer-events-none" />

      {/* Navigation */}
      <Navbar />

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-20 relative z-10">
        {/* Top Breadcrumb */}
        <div className="mb-6">
          <Link
            to={returnTo}
            className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors py-1 px-3 rounded-full bg-surface border border-subtle hover:border-strong backdrop-blur-md"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>{legalReturnLabel(returnTo)}</span>
          </Link>
        </div>

        {/* Page Header */}
        <div className="mb-12">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl tracking-tight mb-3">
            <span className="text-display-gradient">Terms of Service</span>
          </h1>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            Please review the rules, terms, and guidelines governing your use of the Bantai platform.
          </p>
          <div className="flex items-center gap-2 mt-4 text-xs font-mono text-muted">
            <span>Last updated: {lastUpdated}</span>
          </div>
        </div>

        {/* Structured Sections */}
        <div className="flex flex-col gap-6">
          {sections.map((sec) => (
            <article
              key={sec.id}
              id={sec.id}
              className="bg-surface border border-subtle dark:bg-zinc-950/70 dark:border-zinc-900/90 rounded-2xl sm:rounded-3xl p-6 sm:p-8 backdrop-blur-xl hardware-sharp"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-elevated border border-subtle flex items-center justify-center">
                  {sec.icon}
                </div>
                <h2 className="font-heading font-medium text-primary text-lg sm:text-xl tracking-tight">
                  {sec.title}
                </h2>
              </div>
              <div className="pl-0 sm:pl-12">
                {sec.content}
              </div>
            </article>
          ))}
        </div>

        {/* Privacy Link Banner */}
        <div className="mt-12 p-6 rounded-2xl bg-elevated border border-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-heading font-medium text-primary text-sm sm:text-base">
              Looking for our Privacy Policy?
            </h3>
            <p className="text-secondary text-xs sm:text-sm mt-0.5">
              Read how we protect, store, and respect your organization’s records and member data.
            </p>
          </div>
          <Link
            to={legalDocumentPath("/privacy", returnTo)}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-action hover:opacity-90 text-action-fg text-xs font-medium transition-opacity shrink-0"
          >
            View Privacy Policy
          </Link>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default TermsOfService;
