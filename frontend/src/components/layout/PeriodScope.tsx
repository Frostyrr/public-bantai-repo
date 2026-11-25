import FloatingMenu from "../ui/FloatingMenu";
import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Calendar, Info, ChevronDown } from 'lucide-react';

export interface PeriodScopeProps {
  balances?: boolean;
  className?: string;
}

export const PeriodScope: React.FC<PeriodScopeProps> = ({ balances = false, className = "" }) => {
  const context = useOutletContext<{
    activePeriodId?: string;
    reportingPeriods?: { id: string; name: string; is_default?: boolean }[];
    setSelectedPeriodId?: (id: string) => void;
  }>();

  const activePeriodId = context?.activePeriodId ?? "all";
  const reportingPeriods = context?.reportingPeriods ?? [];
  const setSelectedPeriodId = context?.setSelectedPeriodId;

  const [isOpen, setIsOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activePeriod = reportingPeriods.find((p) => p.id === activePeriodId);
  const name = activePeriod?.name || (activePeriodId === "all" ? "All time" : "All time");
  const canSwitch = Boolean(setSelectedPeriodId && reportingPeriods.length > 0);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowDetails(false);
      }
    };
    if (isOpen || showDetails) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, showDetails]);

  return (
    <div ref={containerRef} className={`relative inline-flex flex-wrap items-center gap-2 ${className}`}>
      {/* Scope Pill (clickable to switch period if available) */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            if (canSwitch) {
              setIsOpen((prev) => !prev);
              setShowDetails(false);
            }
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-elevated border border-subtle text-xs font-mono text-secondary transition-all ${
            canSwitch
              ? "hover:bg-surface hover:border-strong cursor-pointer"
              : "cursor-default"
          }`}
          title={canSwitch ? "Click to switch reporting scope" : "Current Reporting Scope"}
        >
          <Calendar className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-muted">Scope:</span>
          <span className="font-medium text-primary">{name}</span>
          {canSwitch && (
            <ChevronDown
              className={`w-3 h-3 text-secondary transition-transform duration-200 ${
                isOpen ? "rotate-180 text-primary" : ""
              }`}
            />
          )}
        </button>

        {setSelectedPeriodId && (
          <FloatingMenu open={isOpen} onClose={() => setIsOpen(false)} className="absolute left-0 top-full mt-1.5 w-56 rounded-xl bg-surface border border-subtle shadow-2xl p-1.5 z-[99999] backdrop-blur-md">
            <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted border-b border-subtle">
              Select Scope
            </div>
            <div className="py-1 max-h-52 overflow-y-auto space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedPeriodId("all");
                  setIsOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer transition-colors ${
                  activePeriodId === "all"
                    ? "bg-elevated text-primary font-medium"
                    : "text-secondary hover:text-primary hover:bg-elevated"
                }`}
              >
                All time (Historical)
              </button>
              {reportingPeriods.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedPeriodId(p.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer transition-colors ${
                    activePeriodId === p.id
                      ? "bg-elevated text-primary font-medium"
                      : "text-secondary hover:text-primary hover:bg-elevated"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  {p.is_default && (
                    <span className="text-[9px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20">
                      Current
                    </span>
                  )}
                </button>
              ))}
            </div>
          </FloatingMenu>
        )}
      </div>

      {/* Calculation Rules Dropdown (for Reports) */}
      {balances && (
        <div className="relative">
          <button
            type="button"
            aria-expanded={showDetails}
            onClick={() => {
              setShowDetails((prev) => !prev);
              setIsOpen(false);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-secondary hover:text-primary px-2 py-0.5 rounded-full bg-elevated hover:bg-surface border border-subtle transition-colors cursor-pointer"
            title="View calculation and scope rules"
          >
            <Info className="w-3 h-3 text-secondary" />
            <span>Rules</span>
            <ChevronDown
              className={`w-3 h-3 text-secondary transition-transform duration-200 ${
                showDetails ? "rotate-180 text-primary" : ""
              }`}
            />
          </button>

          <FloatingMenu
            open={showDetails}
            onClose={() => setShowDetails(false)}
            className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-surface border border-subtle shadow-2xl p-4 z-[99999] backdrop-blur-md text-xs text-secondary leading-relaxed space-y-2.5"
          >
            <div className="pb-2 text-[10px] font-mono uppercase tracking-wider text-muted border-b border-subtle">
              Calculation &amp; Scope Rules
            </div>
            <p>
              <strong className="text-primary">Organization Reserves:</strong> Reserve balances and outstanding cash advances remain organization-wide across all fiscal cycles.
            </p>
            <p>
              <strong className="text-primary">Collection &amp; Budget Figures:</strong> Totals include the full historical transaction ledger for all records assigned to this scope.
            </p>
          </FloatingMenu>
        </div>
      )}
    </div>
  );
};

export default PeriodScope;
