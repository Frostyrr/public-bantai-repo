import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import Select from "./Select";

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  itemLabel?: string;
  className?: string;
  showFirstLast?: boolean;
}

export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  itemLabel = "entries",
  className = "",
  showFirstLast = true,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  // If page state is out of sync with safePage, clamp it
  if (currentPage !== safePage && totalItems > 0) {
    // defer callback to prevent React render cycle warning
    setTimeout(() => onPageChange(safePage), 0);
  }

  const startItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endItem = Math.min(safePage * pageSize, totalItems);

  // Calculate sliding page numbers with ellipses
  const getPageNumbers = (): (number | "ellipsis")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    if (safePage <= 4) {
      return [1, 2, 3, 4, 5, "ellipsis", totalPages];
    }

    if (safePage >= totalPages - 3) {
      return [
        1,
        "ellipsis",
        totalPages - 4,
        totalPages - 3,
        totalPages - 2,
        totalPages - 1,
        totalPages,
      ];
    }

    return [
      1,
      "ellipsis",
      safePage - 1,
      safePage,
      safePage + 1,
      "ellipsis",
      totalPages,
    ];
  };

  const pageNumbers = getPageNumbers();

  return (
    <nav
      aria-label="Pagination Navigation"
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-subtle px-4 py-3 font-body text-sm tabular-nums ${className}`}
    >
      {/* Range Summary */}
      <div className="flex items-center gap-3 text-secondary order-2 sm:order-1">
        <span>
          Showing{" "}
          <strong className="font-mono font-medium text-primary">
            {startItem}
          </strong>
          –
          <strong className="font-mono font-medium text-primary">
            {endItem}
          </strong>{" "}
          of{" "}
          <strong className="font-mono font-medium text-primary">
            {totalItems}
          </strong>{" "}
          {itemLabel}
        </span>

        {pageSizeOptions && onPageSizeChange && (
          <div className="flex items-center gap-1.5 pl-3 border-l border-subtle">
            <span className="text-muted text-[11px] font-mono">Per page:</span>
            <Select
              value={pageSize}
              onChange={(e) => {
                const nextSize = Number(e.target.value);
                onPageSizeChange(nextSize);
                onPageChange(1);
              }}
              variant="pill"
              selectSize="sm"
              menuWidth="auto"
              options={pageSizeOptions.map((opt) => ({
                value: opt,
                label: String(opt),
              }))}
            />
          </div>
        )}
      </div>

      {/* Page Navigation Buttons */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 order-1 sm:order-2">
          {showFirstLast && (
            <button
              type="button"
              onClick={() => onPageChange(1)}
              disabled={safePage === 1}
              aria-label="First page"
              title="First page"
              className="p-1.5 rounded-lg border border-subtle bg-elevated text-secondary hover:text-primary hover:bg-surface hover:border-strong disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage === 1}
            aria-label="Previous page"
            title="Previous page"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-subtle bg-elevated text-secondary hover:text-primary hover:bg-surface hover:border-strong disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer font-mono text-xs"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden md:inline">Prev</span>
          </button>

          <div className="flex items-center gap-1 mx-1">
            {pageNumbers.map((p, idx) => {
              if (p === "ellipsis") {
                return (
                  <span
                    key={`ellipsis-${idx}`}
                    className="w-7 text-center font-mono text-muted select-none"
                  >
                    …
                  </span>
                );
              }

              const isCurrent = p === safePage;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  aria-label={`Page ${p}`}
                  aria-current={isCurrent ? "page" : undefined}
                  className={`min-w-8 h-8 px-2 rounded-lg font-mono text-xs transition-all flex items-center justify-center cursor-pointer ${
                    isCurrent
                      ? "bg-action text-action-fg font-semibold shadow-sm"
                      : "border border-subtle bg-elevated text-secondary hover:text-primary hover:bg-surface hover:border-strong"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage === totalPages}
            aria-label="Next page"
            title="Next page"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-subtle bg-elevated text-secondary hover:text-primary hover:bg-surface hover:border-strong disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer font-mono text-xs"
          >
            <span className="hidden md:inline">Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>

          {showFirstLast && (
            <button
              type="button"
              onClick={() => onPageChange(totalPages)}
              disabled={safePage === totalPages}
              aria-label="Last page"
              title="Last page"
              className="p-1.5 rounded-lg border border-subtle bg-elevated text-secondary hover:text-primary hover:bg-surface hover:border-strong disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
