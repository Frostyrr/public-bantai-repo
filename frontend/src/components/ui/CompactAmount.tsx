import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";
import {
  formatCompactCurrency,
  formatCompactPHP,
  formatExactCurrency,
  formatExactPHP,
} from "../../utils/formatCompactPHP";

export interface CompactAmountProps {
  /** Monetary amount in minor units (centavos). Takes precedence over `amount` when provided. */
  centavos?: number | bigint | string;
  /** Monetary amount in major units (pesos). Used when `centavos` is omitted. */
  amount?: number;
  /** Currency code or symbol (defaults to "PHP"). */
  currency?: string;
  className?: string;
  /** Applies the subtle metric settle animation when the compact display changes. */
  animate?: boolean;
  /** Popover heading label (defaults to "Exact amount"). */
  label?: string;
}

const COMPACT_OPEN_EVENT = "bantai:compact-amount-open";

/**
 * Displays a compact currency value (up to 5 significant digits, e.g. ₱153.25K, ₱1.5325M)
 * inside a semantic button and reveals the exact value in a lightweight top-layer
 * popover on click or keyboard activation without causing layout shifts.
 */
export default function CompactAmount({
  centavos,
  amount,
  currency = "PHP",
  className = "",
  animate = false,
  label = "Exact amount",
}: CompactAmountProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const openOnHover = () => {
    clearHoverTimer();
    if (!isOpen) {
      window.dispatchEvent(new CustomEvent(COMPACT_OPEN_EVENT, { detail: popoverId }));
      setIsOpen(true);
    }
  };

  const scheduleCloseOnLeave = () => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      setCopied(false);
      hoverTimerRef.current = null;
    }, 140);
  };

  const hasCentavos = centavos !== undefined;
  const compact = hasCentavos
    ? formatCompactCurrency(centavos, currency)
    : formatCompactPHP(amount ?? 0, currency);
  const exact = hasCentavos
    ? formatExactCurrency(centavos, currency)
    : formatExactPHP(amount ?? 0, currency);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleOtherOpen = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (custom.detail !== popoverId) {
        setIsOpen(false);
        setCopied(false);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setIsOpen(false);
        setCopied(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setCopied(false);
      triggerRef.current?.focus();
    };

    window.addEventListener(COMPACT_OPEN_EVENT, handleOtherOpen);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener(COMPACT_OPEN_EVENT, handleOtherOpen);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, popoverId]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const vpLeft = viewport?.offsetLeft ?? 0;
      const vpTop = viewport?.offsetTop ?? 0;
      const vpWidth = viewport?.width ?? window.innerWidth;
      const vpHeight = viewport?.height ?? window.innerHeight;
      const edge = 8;
      const gap = 6;

      popover.style.maxWidth = `${Math.max(0, vpWidth - edge * 2)}px`;
      const popWidth = popover.offsetWidth;
      const popHeight = popover.offsetHeight;

      const aboveTop = rect.top - gap - popHeight;
      const belowTop = rect.bottom + gap;
      const canPlaceAbove = aboveTop >= vpTop + edge;
      const canPlaceBelow = belowTop + popHeight <= vpTop + vpHeight - edge;

      let top: number;
      let placement: "top" | "bottom";
      if (canPlaceAbove || (!canPlaceBelow && rect.top - vpTop >= vpTop + vpHeight - rect.bottom)) {
        top = Math.max(vpTop + edge, aboveTop);
        placement = "top";
      } else {
        top = Math.min(vpTop + vpHeight - popHeight - edge, belowTop);
        placement = "bottom";
      }

      const left = Math.max(
        vpLeft + edge,
        Math.min(rect.left, vpLeft + vpWidth - popWidth - edge),
      );

      popover.dataset.placement = placement;
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.style.visibility = "visible";
    };

    popover.style.visibility = "hidden";
    position();

    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(popover);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [isOpen, exact]);

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      setCopied(false);
      return;
    }
    window.dispatchEvent(new CustomEvent(COMPACT_OPEN_EVENT, { detail: popoverId }));
    setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setCopied(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
    }
  };

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard?.writeText(exact);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      /* Clipboard access may be unavailable in restricted contexts. */
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-compact-amount=""
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        aria-haspopup="dialog"
        aria-label={`${compact} (Exact amount: ${exact})`}
        title={isOpen ? undefined : exact}
        onClick={handleToggle}
        onMouseEnter={openOnHover}
        onMouseLeave={scheduleCloseOnLeave}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-baseline whitespace-nowrap appearance-none bg-transparent border-0 p-0 m-0 [font:inherit] [color:inherit] [letter-spacing:inherit] text-left tabular-nums cursor-pointer rounded-sm transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong ${className}`.trim()}
      >
        {animate ? (
          <span key={compact} className="animate-metric-settle">
            {compact}
          </span>
        ) : (
          compact
        )}
      </button>

      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label={`${label}: ${exact}`}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseEnter={openOnHover}
            onMouseLeave={scheduleCloseOnLeave}
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              zIndex: 2147483647,
              margin: 0,
            }}
            className="rounded-xl bg-surface border border-strong shadow-2xl px-3 py-2 text-primary backdrop-blur-md animate-tooltip-enter select-text"
          >
            <span className="block text-[10px] font-mono uppercase tracking-wider text-muted select-none">
              {label}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs sm:text-[13px] font-mono font-semibold tabular-nums text-primary whitespace-nowrap select-all">
                {exact}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy exact amount"
                title={copied ? "Copied" : "Copy exact amount"}
                className="inline-flex size-5 items-center justify-center rounded-md text-muted hover:bg-hover-surface hover:text-primary focus-visible:outline-2 focus-visible:outline-strong cursor-pointer transition-colors"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                ) : (
                  <Copy className="w-3 h-3" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
