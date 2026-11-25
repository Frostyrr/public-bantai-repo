import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import ScrollReveal from '../ui/ScrollReveal';

type FaqCategory = 'All' | 'Workspace & Roles' | 'Bani AI' | 'Security & Billing';

interface FaqItem {
  id: string;
  category: Exclude<FaqCategory, 'All'>;
  question: string;
  answer: string;
}

const CATEGORIES: FaqCategory[] = ['All', 'Workspace & Roles', 'Bani AI', 'Security & Billing'];

const QUESTIONS: FaqItem[] = [
  {
    id: 'bani-records',
    category: 'Bani AI',
    question: 'Can Bani change financial records?',
    answer:
      'Bani can retrieve and summarize financial information in your organization workspace. It cannot approve expenses, record payments, or modify budgets. Your officers remain responsible for reviewing and updating records.',
  },
  {
    id: 'who-is-bantai-for',
    category: 'Workspace & Roles',
    question: 'Who is Bantai for?',
    answer:
      'Bantai is for organizations and member-based groups that need a shared place to track contributions, budgets, expenses, and financial records.',
  },
  {
    id: 'join-org',
    category: 'Workspace & Roles',
    question: 'How do I join an organization?',
    answer:
      'Create an account, open your dashboard, and choose Join Organization. Enter the invite code provided by your organization. You can also create a new organization from the dashboard.',
  },
  {
    id: 'org-roles',
    category: 'Workspace & Roles',
    question: 'What can each organization role do?',
    answer:
      'Admins manage the organization and membership. Treasurers manage financial records, auditors review spending, and members follow their contributions. Available actions depend on your assigned role.',
  },
  {
    id: 'auth-methods',
    category: 'Security & Billing',
    question: 'Can I sign in with email or Google?',
    answer:
      'Yes. You can register with email and complete the verification steps, or use Continue with Google. Both options take you to your Bantai workspace.',
  },
  {
    id: 'process-payments',
    category: 'Security & Billing',
    question: 'Does Bantai process payments?',
    answer:
      'No. Payments and money transfers happen outside Bantai. The platform helps your organization record contributions and expenses and track their supporting information.',
  },
  {
    id: 'timezones-due-dates',
    category: 'Workspace & Roles',
    question: 'How do organization time zones affect due dates?',
    answer:
      'Each organization can configure its own IANA time zone in Regional Settings. Due dates and overdue status are evaluated against that time zone so deadlines stay consistent for all officers and members.',
  },
  {
    id: 'tenant-isolation',
    category: 'Security & Billing',
    question: 'Is our financial data isolated from other organizations?',
    answer:
      'Yes. Every workspace is strictly scoped by organization membership and role-based access controls, with audit logs tracking administrative and financial changes.',
  },
];

export default function HomeFaq() {
  const [selectedCategory, setSelectedCategory] = useState<FaqCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(QUESTIONS[0].id);
  const isSearching = searchQuery.trim().length > 0;

  const filteredQuestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return QUESTIONS.filter((item) => {
      const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      return (
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [selectedCategory, searchQuery]);

  return (
    <section
      id="faq"
      tabIndex={-1}
      className="w-full py-24 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto relative hardware-sharp"
    >
      {/* Subtle ambient glow */}
      <div className="pointer-events-none hidden dark:block absolute top-12 left-1/2 -translate-x-1/2 w-[min(480px,100%)] h-[220px] bg-zinc-800/20 blur-[120px] animate-ambient-glow" />

      <div className="relative z-10">
        {/* Centered Header */}
        <ScrollReveal direction="up" distance={10} className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            FAQ
          </p>
          <h2 className="mt-3 text-3xl sm:text-4xl md:text-[40px] leading-[1.12] tracking-[-0.025em]">
            <span className="text-display-gradient">Questions before you get started?</span>
          </h2>
          <p className="mt-3.5 mx-auto font-body font-normal text-secondary text-sm sm:text-base leading-relaxed max-w-xl">
            Everything you need to know about workspaces, officer roles, Bani AI, and how Bantai keeps your records accountable.
          </p>
        </ScrollReveal>

        {/* Search & Category Filters */}
        <ScrollReveal delay={50} direction="up" distance={8} className="mt-8 space-y-4">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-zinc-500" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search questions..."
              aria-label="Search frequently asked questions"
              className="w-full rounded-xl border border-subtle bg-surface py-2.5 pl-10 pr-9 text-sm text-primary placeholder:text-muted outline-none transition-colors focus:border-strong focus:bg-elevated"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="cursor-pointer absolute right-2.5 rounded-md p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Filter questions by category">
            {CATEGORIES.map((category) => {
              const active = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedCategory(category);
                    setOpenId(null);
                  }}
                  className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-white ${
                    active
                      ? 'bg-white text-zinc-950 shadow-sm'
                      : 'border border-subtle bg-surface text-secondary hover:border-strong hover:text-primary'
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </ScrollReveal>

        {/* Clean Divider-Based Accordion List */}
        <div className="mt-10">
          {filteredQuestions.length === 0 ? (
            <div className="border-y border-subtle py-10 text-center">
              <p className="text-sm text-secondary">No questions matched your filter.</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('All');
                  setSearchQuery('');
                }}
                className="cursor-pointer mt-3 text-xs font-medium text-secondary underline underline-offset-4 hover:text-primary transition-colors"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <div className="border-t border-subtle">
              {filteredQuestions.map((item) => {
                const isOpen = openId === item.id;
                const panelId = `faq-panel-${item.id}`;
                return (
                  <div
                    key={item.id}
                    data-open={isOpen}
                    className="border-b border-subtle"
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenId(isOpen ? null : item.id)}
                      className="group flex w-full cursor-pointer items-center justify-between gap-4 py-5 text-left focus-visible:outline-2"
                    >
                      <div className="min-w-0">
                        {isSearching && (
                          <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                            {item.category}
                          </span>
                        )}
                        <span className="block font-heading font-medium text-base sm:text-[17px] text-primary group-hover:text-secondary transition-colors leading-snug">
                          {item.question}
                        </span>
                      </div>
                      <ChevronDown
                        aria-hidden="true"
                        className={`h-4 w-4 shrink-0 text-secondary group-hover:text-primary transition-transform duration-200 ease-out motion-reduce:transition-none ${
                          isOpen ? 'rotate-180 text-primary' : ''
                        }`}
                      />
                    </button>
                    <div
                      id={panelId}
                      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <p className="pb-5 pr-8 font-body font-normal text-sm text-secondary leading-relaxed">
                          {item.answer}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Slim Bottom Support Banner */}
        <ScrollReveal delay={80} direction="up" distance={8}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-secondary">
            <span className="font-medium text-primary">Still have questions?</span>
            <Link
              to="/#contact"
              className="inline-flex items-center gap-1 font-medium text-primary hover:text-secondary transition-colors"
            >
              Contact support
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              to="/about#governance"
              className="text-secondary underline underline-offset-4 hover:text-primary transition-colors"
            >
              Organization roles
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
