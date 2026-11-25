import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";
import {
  composeSeconds,
  decomposeSeconds,
  MAX_DURATION_SECONDS,
  type DurationParts,
} from "../../utils/duration";

const ITEM_HEIGHT = 36;
const VISIBLE_ITEMS = 5;
const CONTAINER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS; // 180px
const SPACER_HEIGHT = ((VISIBLE_ITEMS - 1) / 2) * ITEM_HEIGHT; // 72px

const MASK_STYLE: React.CSSProperties = {
  maskImage:
    "linear-gradient(to bottom, transparent 0%, black 26%, black 74%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent 0%, black 26%, black 74%, transparent 100%)",
};

interface DrumColumnProps {
  label: string;
  unitShort: string;
  max: number;
  value: number;
  disabledNonZero?: boolean;
  onChange: (next: number) => void;
}

function DrumColumn({
  label,
  unitShort,
  max,
  value,
  disabledNonZero = false,
  onChange,
}: DrumColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isProgrammaticRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);
  const programmaticTimerRef = useRef<number | null>(null);

  const items = useMemo(
    () => Array.from({ length: max + 1 }, (_, i) => i),
    [max],
  );

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "auto") => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(max, index));
      const targetTop = clamped * ITEM_HEIGHT;
      if (Math.abs(el.scrollTop - targetTop) < 1) return;

      isProgrammaticRef.current = true;
      if (programmaticTimerRef.current !== null) {
        window.clearTimeout(programmaticTimerRef.current);
      }
      el.scrollTo({ top: targetTop, behavior });
      programmaticTimerRef.current = window.setTimeout(() => {
        isProgrammaticRef.current = false;
      }, behavior === "smooth" ? 260 : 60);
    },
    [max],
  );

  useEffect(() => {
    scrollToIndex(value, "auto");
  }, [value, scrollToIndex]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
      if (programmaticTimerRef.current !== null) window.clearTimeout(programmaticTimerRef.current);
    };
  }, []);

  const commitFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || isProgrammaticRef.current) return;
    const rawIndex = Math.round(el.scrollTop / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(max, rawIndex));
    const effective = disabledNonZero ? 0 : clamped;
    if (disabledNonZero && clamped !== 0) {
      scrollToIndex(0, "smooth");
    }
    if (effective !== value) {
      onChange(effective);
    }
  }, [disabledNonZero, max, onChange, scrollToIndex, value]);

  const handleScroll = () => {
    if (isProgrammaticRef.current) return;
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(commitFromScroll, 75);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabledNonZero) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
      }
      return;
    }

    let next: number | null = null;
    if (event.key === "ArrowDown") {
      next = Math.min(max, value + 1);
    } else if (event.key === "ArrowUp") {
      next = Math.max(0, value - 1);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = max;
    }

    if (next !== null) {
      event.preventDefault();
      if (next !== value) {
        onChange(next);
        scrollToIndex(next, "smooth");
      }
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center min-w-0">
      <span className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
        {label}
      </span>
      <div
        className="relative w-full select-none"
        style={{ height: CONTAINER_HEIGHT }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Center selection highlight pill */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2 h-9 rounded-full bg-zinc-800/80 border border-zinc-700/60"
        />

        <div
          ref={scrollRef}
          role="listbox"
          tabIndex={0}
          aria-label={label}
          aria-activedescendant={`${label}-opt-${value}`}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          style={MASK_STYLE}
          className="relative z-10 h-full w-full overflow-y-auto snap-y snap-mandatory overscroll-contain outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div style={{ height: SPACER_HEIGHT }} className="shrink-0" aria-hidden="true" />
          {items.map((item) => {
            const isSelected = item === value;
            const isBlocked = disabledNonZero && item > 0;
            return (
              <button
                key={item}
                id={`${label}-opt-${item}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isBlocked}
                tabIndex={-1}
                onClick={() => {
                  if (isBlocked) return;
                  onChange(item);
                  scrollToIndex(item, "smooth");
                }}
                style={{ height: ITEM_HEIGHT }}
                className={`w-full snap-center flex items-center justify-center gap-1 font-mono text-sm transition-colors ${
                  isBlocked
                    ? "text-zinc-600 opacity-30 cursor-not-allowed"
                    : isSelected
                      ? "text-emerald-300 font-semibold cursor-pointer"
                      : "text-zinc-400 hover:text-zinc-200 cursor-pointer"
                }`}
              >
                <span>{String(item).padStart(2, "0")}</span>
                <span className="text-[10px] font-sans text-zinc-500">{unitShort}</span>
              </button>
            );
          })}
          <div style={{ height: SPACER_HEIGHT }} className="shrink-0" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export interface DurationDrumPickerProps {
  value: number;
  onChange: (totalSeconds: number) => void;
  className?: string;
}

export default function DurationDrumPicker({
  value,
  onChange,
  className = "",
}: DurationDrumPickerProps) {
  const clampedValue = Math.max(0, Math.min(MAX_DURATION_SECONDS, Math.floor(value || 0)));
  const parts = useMemo(() => decomposeSeconds(clampedValue), [clampedValue]);
  const [showSecondsManual, setShowSecondsManual] = useState(false);
  const showSeconds = showSecondsManual || parts.seconds > 0;

  const updatePart = useCallback(
    (key: keyof DurationParts, nextVal: number) => {
      const nextParts: DurationParts = { ...parts, [key]: nextVal };
      if (nextParts.days >= 30) {
        nextParts.days = 30;
        nextParts.hours = 0;
        nextParts.minutes = 0;
        nextParts.seconds = 0;
      }
      onChange(composeSeconds(nextParts));
    },
    [onChange, parts],
  );

  const isAtMaxDays = parts.days >= 30;

  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-xl ${className}`}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-zinc-800/80">
        <span className="text-[11px] font-medium text-zinc-400">
          Scroll or use arrow keys
        </span>
        <button
          type="button"
          onClick={() => {
            if (showSeconds && parts.seconds > 0) {
              updatePart("seconds", 0);
              setShowSecondsManual(false);
            } else {
              setShowSecondsManual((prev) => !prev);
            }
          }}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
            showSeconds
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Clock className="w-3 h-3" />
          {showSeconds ? "Hide sec" : "+ Seconds"}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <DrumColumn
          label="Days"
          unitShort="d"
          max={30}
          value={parts.days}
          onChange={(v) => updatePart("days", v)}
        />
        <DrumColumn
          label="Hours"
          unitShort="h"
          max={23}
          value={isAtMaxDays ? 0 : parts.hours}
          disabledNonZero={isAtMaxDays}
          onChange={(v) => updatePart("hours", v)}
        />
        <DrumColumn
          label="Minutes"
          unitShort="m"
          max={59}
          value={isAtMaxDays ? 0 : parts.minutes}
          disabledNonZero={isAtMaxDays}
          onChange={(v) => updatePart("minutes", v)}
        />
        {showSeconds && (
          <DrumColumn
            label="Seconds"
            unitShort="s"
            max={59}
            value={isAtMaxDays ? 0 : parts.seconds}
            disabledNonZero={isAtMaxDays}
            onChange={(v) => updatePart("seconds", v)}
          />
        )}
      </div>

      {isAtMaxDays && (
        <p className="mt-2 text-center text-[10px] text-amber-400/90">
          30-day maximum reached — hours, minutes, and seconds are locked to 0.
        </p>
      )}
    </div>
  );
}
