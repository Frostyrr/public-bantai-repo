import { useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

export function WorkspaceSidebar({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <aside className={`hidden min-h-0 shrink-0 flex-col border-r border-subtle motion-safe:transition-[width] motion-safe:duration-300 md:flex ${className}`}>
      {children}
    </aside>
  );
}

export function SidebarNavigation({ className = "", ...props }: ComponentProps<"nav">) {
  return <nav className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`} {...props} />;
}

export function SidebarCollapseButton({ collapsed, onToggle, className = "" }: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button type="button" aria-label={label} title={label} aria-expanded={!collapsed}
      onClick={onToggle}
      className={`grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary hover:bg-hover-surface hover:text-primary focus-visible:ring-2 focus-visible:ring-strong ${className}`}>
      <Icon size={16} className="sidebar-nav-icon" aria-hidden="true" />
    </button>
  );
}

export function WorkspaceSidebarDrawer({ id, label, heading, open, onOpenChange, className = "", children }: {
  id: string;
  label: string;
  heading: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open === open) return;
    if (open) dialog.showModal();
    else dialog.close();
  }, [open]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 48rem)");
    const closeOnDesktop = () => { if (desktop.matches) onOpenChange(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [onOpenChange]);

  return (
    <dialog ref={ref} id={id} aria-label={label}
      onClose={event => { if (!event.currentTarget.open) onOpenChange(false); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) {
          onOpenChange(false);
        }
      }}
      className={`workspace-sidebar-drawer fixed inset-y-0 left-0 m-0 h-dvh max-h-none max-w-[85vw] overflow-hidden border-r border-subtle text-primary backdrop:bg-black/60 ${className}`}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-3 flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-subtle px-2 pb-2">
          {heading}
          <button type="button" aria-label={`Close ${label.toLowerCase()}`}
            onClick={() => onOpenChange(false)}
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary hover:bg-hover-surface hover:text-primary focus-visible:ring-2 focus-visible:ring-strong">
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
