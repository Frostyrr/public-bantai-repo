import type { ReactNode } from "react";

export default function ModuleEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="module-empty-state relative isolate overflow-hidden flex flex-col items-center rounded-2xl border border-subtle bg-surface px-6 py-14 sm:py-16 text-center shadow-xs dark:shadow-none">
      {children}
    </div>
  );
}
