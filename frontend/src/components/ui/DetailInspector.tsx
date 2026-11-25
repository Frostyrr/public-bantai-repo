import React, { useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useInspectorVisibility } from "../../context/WorkspaceInspectors";

const DEFAULT_INSPECTOR_WIDTH = 420;
const MIN_INSPECTOR_WIDTH = 340;
const MAX_INSPECTOR_WIDTH = 760;
const DEFAULT_STORAGE_KEY = "bantai_inspector_width";

function readStoredWidth(
  storageKey: string,
  fallback: number,
  minWidth: number,
  maxWidth: number
): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(minWidth, Math.min(maxWidth, parsed));
  } catch {
    return fallback;
  }
}

export interface DetailInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  categoryLabel: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string;
  ariaLabel?: string;
  onNavigate?: (direction: "prev" | "next") => void;
}

export function DetailInspector({
  isOpen: requestedOpen,
  onClose,
  categoryLabel,
  title,
  subtitle,
  headerActions,
  footer,
  children,
  defaultWidth = DEFAULT_INSPECTOR_WIDTH,
  minWidth = MIN_INSPECTOR_WIDTH,
  maxWidth = MAX_INSPECTOR_WIDTH,
  storageKey = DEFAULT_STORAGE_KEY,
  ariaLabel,
  onNavigate,
}: DetailInspectorProps) {
  const { isOpen, managed } = useInspectorVisibility(requestedOpen);
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    readStoredWidth(storageKey, defaultWidth, minWidth, maxWidth)
  );
  const [isResizingPanel, setIsResizingPanel] = useState(false);

  // Persist width changes to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(panelWidth));
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }, [panelWidth, storageKey]);

  // Pointer drag resizing
  useEffect(() => {
    if (!isOpen || !isResizingPanel) return;

    const handlePointerMove = (e: PointerEvent) => {
      const maxAllowed = Math.min(
        maxWidth,
        Math.floor(window.innerWidth * 0.75)
      );
      const nextWidth = Math.max(
        minWidth,
        Math.min(maxAllowed, Math.round(window.innerWidth - e.clientX))
      );
      setPanelWidth(nextWidth);
    };

    const handlePointerUp = () => setIsResizingPanel(false);
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isOpen, isResizingPanel, maxWidth, minWidth]);

  // Keyboard shortcuts: Esc to close, ArrowUp / ArrowDown to cycle records
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (!onNavigate) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      ) {
        return;
      }

      e.preventDefault();
      onNavigate(e.key === "ArrowUp" ? "prev" : "next");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onNavigate]);

  return (
    <aside
      aria-label={ariaLabel || categoryLabel}
      aria-hidden={!isOpen}
      inert={!isOpen}
      style={
        {
          "--detail-inspector-width": `${panelWidth}px`,
          visibility: managed && !isOpen ? "hidden" : undefined,
        } as React.CSSProperties
      }
      className={`fixed top-(--workspace-navbar-height) right-0 bottom-0 z-40 flex flex-col border-l border-subtle dark:border-white/[0.08] bg-surface dark:bg-[#09090b] shadow-2xl w-full md:w-(--detail-inspector-width) motion-reduce:transition-none ${
        isResizingPanel
          ? "transition-none"
          : "transition-transform duration-300 ease-out"
      } ${isOpen ? "translate-x-0" : "translate-x-full pointer-events-none"}`}
    >
      {requestedOpen && (
        <>
          {/* Drag-to-resize handle on left edge */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${categoryLabel.toLowerCase()} panel`}
            aria-valuemin={minWidth}
            aria-valuemax={maxWidth}
            aria-valuenow={panelWidth}
            title="Drag to resize · Double-click to reset"
            onPointerDown={(e) => {
              e.preventDefault();
              setIsResizingPanel(true);
            }}
            onDoubleClick={() => setPanelWidth(defaultWidth)}
            className="hidden md:flex absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 z-30 cursor-col-resize items-center justify-center group"
          >
            <span
              className={`w-[3px] h-12 rounded-full transition-colors ${
                isResizingPanel
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                  : "bg-white/10 group-hover:bg-white/35"
              }`}
            />
          </div>

          {/* Width indicator & reset bar */}
          <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-b border-subtle dark:border-white/[0.08] bg-white/[0.02] text-[10px] font-mono text-muted shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  isResizingPanel ? "bg-emerald-400" : "bg-white/25"
                }`}
              />
              Inspector · {panelWidth}px
            </span>
            <button
              type="button"
              onClick={() => setPanelWidth(defaultWidth)}
              disabled={panelWidth === defaultWidth}
              title={`Reset to default width (${defaultWidth}px)`}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono text-secondary hover:text-primary hover:bg-hover-surface disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset width
            </button>
          </div>

          {/* Sticky header slot */}
          <div className="flex items-start justify-between gap-3 border-b border-subtle dark:border-white/[0.08] px-5 py-4 shrink-0">
            <div className="min-w-0 space-y-1">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
                {categoryLabel}
              </p>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <h3 className="text-sm font-heading font-medium text-primary truncate">
                  {title}
                </h3>
                {subtitle}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector panel"
                className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-hover-surface transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-4 text-xs">
            {children}
          </div>

          {/* Optional sticky footer slot */}
          {footer && (
            <div className="shrink-0 border-t border-subtle dark:border-white/[0.08] bg-surface dark:bg-[#09090b] px-5 py-3.5">
              {footer}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

export function InspectorGrid({
  columns = 2,
  children,
  className = "",
}: {
  columns?: 2 | 3;
  children: React.ReactNode;
  className?: string;
}) {
  const colClass = columns === 3 ? "grid-cols-3" : "grid-cols-2";
  return <div className={`grid ${colClass} gap-2.5 ${className}`}>{children}</div>;
}

export function InspectorField({
  label,
  value,
  mono = false,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/60 dark:bg-white/[0.02] p-3 space-y-1 ${className}`}
    >
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted">
        {label}
      </p>
      <div
        className={`text-primary font-medium break-words ${
          mono ? "font-mono tabular-nums" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export function InspectorSection({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

export default DetailInspector;
