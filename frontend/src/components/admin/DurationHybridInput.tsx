import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  formatDurationSummary,
  getBestUnitRepresentation,
  isSingleCleanUnit,
  UNIT_MULTIPLIERS,
  type DurationUnit,
} from "../../utils/duration";
import DurationDrumPicker from "./DurationDrumPicker";

export interface DurationPreset {
  label: string;
  seconds: number;
}

export interface DurationHybridInputProps {
  label: string;
  value: number;
  onChange: (totalSeconds: number) => void;
  presets: DurationPreset[];
  defaultEnabledSeconds?: number;
  error?: string;
}

const UNIT_OPTIONS: Array<{ value: DurationUnit; label: string }> = [
  { value: "seconds", label: "Seconds" },
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];

export default function DurationHybridInput({
  label,
  value,
  onChange,
  presets,
  defaultEnabledSeconds = 900,
  error,
}: DurationHybridInputProps) {
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastEnabledRef = useRef<number>(
    value > 0 ? value : defaultEnabledSeconds,
  );

  const isEnabled = value > 0;
  const best = getBestUnitRepresentation(value);
  const cleanSingleUnit = isSingleCleanUnit(value);

  const [selectedUnit, setSelectedUnit] = useState<DurationUnit | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [draftText, setDraftText] = useState<string>("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const unit: DurationUnit = isFocused
    ? (selectedUnit ?? (value > 0 ? best.unit : getBestUnitRepresentation(defaultEnabledSeconds).unit))
    : value > 0
      ? best.unit
      : (selectedUnit ?? getBestUnitRepresentation(defaultEnabledSeconds).unit);

  const emitChange = (nextSeconds: number) => {
    if (nextSeconds > 0) {
      lastEnabledRef.current = nextSeconds;
    }
    onChange(nextSeconds);
  };

  // Close desktop popover on outside click or Escape
  useEffect(() => {
    if (!isPickerOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsPickerOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPickerOpen]);

  const handleToggleEnabled = () => {
    if (isEnabled) {
      lastEnabledRef.current = value;
      setIsPickerOpen(false);
      emitChange(0);
    } else {
      const restored =
        lastEnabledRef.current > 0
          ? lastEnabledRef.current
          : defaultEnabledSeconds;
      emitChange(restored);
    }
  };

  const numericValueForCurrentUnit =
    value > 0 ? Math.max(1, Math.round(value / UNIT_MULTIPLIERS[unit])) : 0;

  const displayValue = isFocused
    ? draftText
    : !isEnabled
      ? "Disabled (0)"
      : cleanSingleUnit
        ? String(best.value)
        : formatDurationSummary(value);

  const handleFocus = () => {
    setIsFocused(true);
    if (!isEnabled) {
      setDraftText("");
      return;
    }
    setSelectedUnit(best.unit);
    if (cleanSingleUnit) {
      setDraftText(String(best.value));
    } else {
      setDraftText(String(Math.round(value / UNIT_MULTIPLIERS[best.unit])));
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    setSelectedUnit(null);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    if (!/^\d*$/.test(raw)) return;
    setDraftText(raw);
    if (raw === "") return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      emitChange(parsed * UNIT_MULTIPLIERS[unit]);
    }
  };

  const handleUnitChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextUnit = event.target.value as DurationUnit;
    setSelectedUnit(nextUnit);
    if (!isEnabled) return;
    const baseNum = isFocused
      ? Number(draftText || 0)
      : numericValueForCurrentUnit;
    if (Number.isFinite(baseNum) && baseNum > 0) {
      emitChange(baseNum * UNIT_MULTIPLIERS[nextUnit]);
    }
  };

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={inputId}
          className="text-xs font-medium text-zinc-200"
        >
          {label}
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={isEnabled}
          aria-label={`Toggle ${label}`}
          onClick={handleToggleEnabled}
          className="inline-flex items-center gap-2 text-[11px] font-medium cursor-pointer group"
        >
          <span
            className={
              isEnabled
                ? "text-emerald-400"
                : "text-zinc-500 group-hover:text-zinc-400"
            }
          >
            {isEnabled ? "Enabled" : "Disabled"}
          </span>
          <span
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
              isEnabled
                ? "border-emerald-500/50 bg-emerald-600"
                : "border-zinc-700 bg-zinc-800"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
                isEnabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      {/* Composite Input + Drum Picker Anchor */}
      <div className="relative">
        <div
          className={`flex items-center rounded-xl border bg-zinc-950/80 transition-colors ${
            error
              ? "border-rose-500/60 focus-within:border-rose-500 focus-within:ring-1 focus-within:ring-rose-500/30"
              : "border-zinc-800 focus-within:border-emerald-500/60 focus-within:ring-1 focus-within:ring-emerald-500/30"
          } ${!isEnabled ? "opacity-55" : ""}`}
        >
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            value={displayValue}
            disabled={!isEnabled}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={handleInputChange}
            placeholder="0"
            aria-invalid={Boolean(error)}
            className={`min-w-0 flex-1 bg-transparent px-3 py-2 text-xs outline-none ${
              isEnabled && (cleanSingleUnit || isFocused)
                ? "font-mono text-zinc-100"
                : "font-sans text-zinc-300"
            } disabled:cursor-not-allowed`}
          />

          <div className="h-5 w-px bg-zinc-800 shrink-0" aria-hidden="true" />

          <div className="relative flex items-center shrink-0">
            <select
              aria-label={`${label} unit`}
              value={unit}
              disabled={!isEnabled}
              onChange={handleUnitChange}
              className="appearance-none bg-transparent pl-2.5 pr-6 py-2 text-[11px] font-medium text-zinc-300 outline-none cursor-pointer disabled:cursor-not-allowed"
            >
              {UNIT_OPTIONS.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  className="bg-zinc-900 text-zinc-100"
                >
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 w-3.5 h-3.5 text-zinc-500" />
          </div>

          <div className="h-5 w-px bg-zinc-800 shrink-0" aria-hidden="true" />

          <button
            type="button"
            aria-label={`Open ${label} wheel picker`}
            aria-expanded={isPickerOpen}
            onClick={() => setIsPickerOpen((prev) => !prev)}
            className={`px-2.5 py-2 transition-colors cursor-pointer rounded-r-xl ${
              isPickerOpen
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Drum Picker: inline on mobile (<640px), popover on desktop (>=640px) */}
        {isPickerOpen && (
          <div className="mt-2 sm:absolute sm:right-0 sm:top-full sm:z-30 sm:mt-2 sm:w-80">
            <DurationDrumPicker
              value={value}
              onChange={(nextSeconds) => {
                emitChange(nextSeconds);
              }}
            />
          </div>
        )}
      </div>

      {/* Quick Preset Chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => {
          const isActive = value === preset.seconds;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => emitChange(preset.seconds)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer ${
                isActive
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 font-medium"
                  : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-[11px] text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
