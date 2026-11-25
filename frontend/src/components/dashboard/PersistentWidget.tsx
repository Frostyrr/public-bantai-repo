import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import useAuth from "../../hooks/useAuth";

interface SavedDisclosureProps {
  storageKey: string;
  title: string;
  icon: ReactNode;
  headerContent: ReactNode;
  children: ReactNode;
  className?: string;
}

function SavedDisclosure({
  storageKey,
  title,
  icon,
  headerContent,
  children,
  className = "",
}: SavedDisclosureProps) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== "collapsed";
    } catch {
      return true;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, next ? "expanded" : "collapsed");
    } catch {
      /* Optional preference storage. */
    }
  };

  return (
    <section
      className={`card-specular-interactive rounded-2xl bg-surface border border-subtle p-4 backdrop-blur-xl shadow-(--shadow-card) dark:shadow-none ${className}`}
    >
      <div
        onClick={toggle}
        className="flex items-center justify-between gap-3 cursor-pointer select-none"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="w-8 h-8 shrink-0 rounded-lg bg-secondary-surface border border-subtle flex items-center justify-center text-secondary">
            {icon}
          </div>
          <div className="min-w-0">{headerContent}</div>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          aria-expanded={open}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-secondary transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-strong"
        >
          <ChevronDown
            aria-hidden="true"
            className={`w-4 h-4 transition-transform duration-200 ease-out motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      <div
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out motion-reduce:transition-none ${
          open
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0 pointer-events-none"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={`transition-transform duration-250 ease-out motion-reduce:transition-none ${
              open ? "translate-y-0" : "-translate-y-3"
            }`}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function PersistentWidget({
  orgId,
  name,
  title,
  icon,
  headerContent,
  children,
  className,
}: {
  orgId: string;
  name: string;
  title: string;
  icon: ReactNode;
  headerContent: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { user } = useAuth();
  const storageKey = `bantai_widget_${user?.id || "anonymous"}_${orgId}_${name}`;
  return (
    <SavedDisclosure
      key={storageKey}
      storageKey={storageKey}
      title={title}
      icon={icon}
      headerContent={headerContent}
      className={className}
    >
      {children}
    </SavedDisclosure>
  );
}
