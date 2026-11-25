import type { ReactNode } from "react";

export default function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-full rounded-2xl border border-subtle bg-surface p-7 shadow-[0_18px_50px_-12px_rgba(15,23,42,0.08)] sm:p-8 dark:border-zinc-800/90 dark:bg-[#09090B] dark:shadow-none before:pointer-events-none before:absolute before:inset-x-12 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-black/10 dark:before:via-white/25 before:to-transparent">
      {children}
    </div>
  );
}
