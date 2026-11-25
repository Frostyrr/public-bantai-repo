import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { legalDocumentPath, legalReturnLabel, legalReturnPath } from '../../lib/legalNavigation';
import { ShieldCheck, ChevronLeft, Eye, Lock, Database, UserCheck, HelpCircle } from 'lucide-react';
import Navbar from '../../components/layout/Navbar';
import Footer from '../../components/layout/Footer';
import background from '../../assets/bg.webp';

export const PrivacyPolicy: React.FC = () => {
  const { search } = useLocation();
  const returnTo = legalReturnPath(search);
  const lastUpdated = 'November 12, 2026';

  const sections = [
    {
      id: 'overview',
      icon: <Eye className="w-5 h-5 text-secondary shrink-0" />,
      title: '1. Overview & Commitment',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            At Bantai, we believe transparency and privacy go hand in hand. We are committed to protecting the personal information of our users and safeguarding the integrity of your organization’s financial records.
          </p>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            This Privacy Policy explains what information we collect when you use Bantai, how we handle that data, and the rights you have regarding your information.
          </p>
        </>
      ),
    },
    {
      id: 'collection',
      icon: <Database className="w-5 h-5 text-secondary shrink-0" />,
      title: '2. Information We Collect',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            We collect only the information necessary to provide you with a reliable, collaborative financial tracking experience:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary text-sm sm:text-base leading-relaxed mb-3">
            <li>
              <strong className="text-primary">Account Information:</strong> We collect your email address, public username, and profile picture URL. Personal information includes first and last names, an optional middle name, and an optional birthdate. These private account fields are not automatically shared with organization members or Bani. Organization roster information supplied separately by officers is distinct from your private account information. Existing accounts can complete missing personal information without losing workspace access.
            </li>
            <li>
              <strong className="text-primary">Organization &amp; Financial Records:</strong> When you manage an organization, we store organization names, categories, member email rosters, budget allocations, expense submissions, proof-of-payment receipts, and liquidation summaries.
              You may also choose a separate display name for each organization membership; other members in that organization can see it. Without one, your public username is used.
            </li>
            <li>
              <strong className="text-primary">Audit History:</strong> Actions taken within an organization (such as approving an expense or updating a role) are recorded with an immutable account reference and timestamp. Changing a username or organization display name does not change transaction ownership or rewrite earlier audit snapshots.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'usage',
      icon: <UserCheck className="w-5 h-5 text-secondary shrink-0" />,
      title: '3. How We Use Your Information',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            We use the information we collect strictly to operate, maintain, and improve Bantai:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary text-sm sm:text-base leading-relaxed mb-3">
            <li>To authenticate you and verify your permissions within each organization.</li>
            <li>To display accurate balances, budgets, expenses, and liquidation statuses in real-time.</li>
            <li>To send essential transactional notifications, such as email verification codes and password reset links.</li>
            <li>To provide audit transparency to verified organization members and officers.</li>
          </ul>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            <strong className="text-primary">We do not sell, rent, or trade your personal information or financial records to third-party advertisers.</strong>
          </p>
        </>
      ),
    },
    {
      id: 'storage',
      icon: <Lock className="w-5 h-5 text-secondary shrink-0" />,
      title: '4. Data Storage & Protection',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            We employ modern industry standards to protect your data against unauthorized access, loss, or misuse:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary text-sm sm:text-base leading-relaxed mb-3">
            <li>
              <strong className="text-primary">Session Security:</strong> We use secure, HTTP-only authentication cookies and encrypted connections for all data in transit.
            </li>
            <li>
              <strong className="text-primary">Role-Based Access:</strong> Access to organization records is strictly isolated; only verified members of an organization can view its financial workspace.
            </li>
            <li>
              <strong className="text-primary">Attachment Storage:</strong> Uploaded receipts and document attachments are stored in secure cloud storage accessible only through authenticated requests.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'third-parties',
      icon: <ShieldCheck className="w-5 h-5 text-secondary shrink-0" />,
      title: '5. Third-Party Integrations',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            We integrate with trusted third-party service providers solely to deliver core application functionality:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary text-sm sm:text-base leading-relaxed mb-3">
            <li>
              <strong className="text-primary">Google OAuth:</strong> Allows you to conveniently sign in using your existing Google account. We only receive your basic public profile (name, email, avatar).
            </li>
            <li>
              <strong className="text-primary">Transactional Email:</strong> Used to deliver critical account security messages (email verification codes, password resets).
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'rights',
      icon: <UserCheck className="w-5 h-5 text-secondary shrink-0" />,
      title: '6. Your Rights & Data Choices',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            You have full control over your personal data:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-secondary text-sm sm:text-base leading-relaxed mb-3">
            <li>
              <strong className="text-primary">Access &amp; Export:</strong> You can view all financial entries, budgets, and audit logs directly in the app or export reports in CSV format.
            </li>
            <li>
              <strong className="text-primary">Updating Information:</strong> You can edit your profile details, display name, and avatar directly from your account settings.
            </li>
            <li>
              <strong className="text-primary">Deletion Requests:</strong> Organization owners may delete or archive organization workspaces. You can request account deletion by contacting support.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'contact',
      icon: <HelpCircle className="w-5 h-5 text-secondary shrink-0" />,
      title: '7. Policy Updates & Contact Information',
      content: (
        <>
          <p className="text-secondary text-sm sm:text-base leading-relaxed mb-3">
            We may periodically update this Privacy Policy to reflect enhancements to our service. Any material changes will be announced on this page with an updated revision date.
          </p>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            If you have questions about how your data is handled, feel free to reach out via our{' '}
            <Link to="/contact" className="text-primary hover:opacity-80 underline underline-offset-2">
              Contact Page
            </Link>{' '}
            or write to{' '}
            <a href="mailto:privacy@bantai.org" className="text-primary hover:underline">
              privacy@bantai.org
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
            <span className="text-display-gradient">Privacy Policy</span>
          </h1>
          <p className="text-secondary text-sm sm:text-base leading-relaxed">
            How Bantai collects, respects, and protects your information and organization records.
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

        {/* Terms Link Banner */}
        <div className="mt-12 p-6 rounded-2xl bg-elevated border border-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-heading font-medium text-primary text-sm sm:text-base">
              Review our Terms of Service
            </h3>
            <p className="text-secondary text-xs sm:text-sm mt-0.5">
              Learn more about roles, workspace governance, and acceptable use guidelines.
            </p>
          </div>
          <Link
            to={legalDocumentPath("/terms", returnTo)}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-action hover:opacity-90 text-action-fg text-xs font-medium transition-opacity shrink-0"
          >
            View Terms of Service
          </Link>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
