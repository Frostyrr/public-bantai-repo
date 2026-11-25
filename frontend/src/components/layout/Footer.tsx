import { Link, useLocation } from 'react-router-dom';
import { legalDocumentPath, legalReturnPath } from '../../lib/legalNavigation';
import BantaiLogo from '../ui/BantaiLogo';

const groups = [
  { title: 'Platform', links: [['Features', '/#features'], ['How it works', '/#accountability'], ['Pricing', '/subscriptions'], ['Sign in', '/login'], ['Create an account', '/register']] },
  { title: 'Resources', links: [['FAQ', '/#faq'], ['About', '/about'], ['Contact', '/#contact']] },
  { title: 'Legal', links: [['Terms', '/terms'], ['Privacy', '/privacy']] },
] as const;

export function Footer() {
  const { pathname, search } = useLocation();
  const returnTo = legalReturnPath(search, pathname);
  return (
    <footer className="relative z-10 w-full border-t border-subtle bg-surface dark:bg-black px-4 py-12 font-body text-sm text-secondary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 md:grid-cols-[1fr_1.5fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-2 font-heading text-base font-medium text-primary">
              <BantaiLogo className="size-6" />
              Bantai
            </Link>
            <p className="mt-3">Financial Accountability &amp; Management Platform</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            {groups.map(({ title, links }) => (
              <div key={title}>
                <p className="mb-3 font-medium text-primary">{title}</p>
                <ul className="space-y-2">
                  {links.map(([label, to]) => (
                    <li key={to}><Link to={to === '/terms' || to === '/privacy' ? legalDocumentPath(to, returnTo) : to} className="transition-colors hover:text-primary">{label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-subtle pt-5 text-xs">
          <span>&copy; {new Date().getFullYear()} Bantai</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-subtle bg-elevated dark:border-zinc-800 dark:bg-zinc-950 px-3 py-1.5 text-secondary">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
            All systems operational
          </span>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
