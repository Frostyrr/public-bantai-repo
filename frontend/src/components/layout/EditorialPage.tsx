import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import Navbar from "./Navbar";
import Footer from "./Footer";

export function EditorialPage({ path, title, description, children }: {
  path: "/about"; title: string; description: string; children: ReactNode;
}) {
  const canonical = new URL(path, import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin).href;
  return <div className="min-h-screen bg-canvas font-body text-primary">
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <meta property="og:url" content={canonical} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <Navbar />
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-32 sm:px-10 sm:pt-44">{children}</main>
    <Footer />
  </div>;
}

export function EditorialLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex min-h-11 items-center gap-2 rounded-sm font-medium text-primary underline decoration-muted underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-4">
    {children}<ArrowUpRight size={16} aria-hidden="true" />
  </Link>;
}
