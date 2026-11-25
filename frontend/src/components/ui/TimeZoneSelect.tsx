import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import Badge from "./Badge";
import FloatingMenu from "./FloatingMenu";
import { FieldError } from "./FieldFeedback";
import {
  buildTimeZoneOption,
  getTimeZoneOptions,
  isValidIanaTimeZone,
  type TimeZoneOption,
} from "../../lib/timezones";

interface TimeZoneSelectProps {
  suggestedTimeZone?: string;
  label?: string;
  value: string;
  onChange: (timeZone: string) => void;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  id?: string;
}

export default function TimeZoneSelect({
  suggestedTimeZone,
  label = "Organization time zone",
  value,
  onChange,
  disabled = false,
  placeholder = "Select organization time zone",
  error,
  id,
}: TimeZoneSelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allOptions = useMemo<TimeZoneOption[]>(() => {
    const options = getTimeZoneOptions();
    if (!suggestedTimeZone || !isValidIanaTimeZone(suggestedTimeZone)) return options;
    const suggested = options.find(option => option.value === suggestedTimeZone)
      ?? buildTimeZoneOption(suggestedTimeZone);
    return [suggested, ...options.filter(option => option.value !== suggestedTimeZone)];
  }, [suggestedTimeZone]);

  const selectedOption = useMemo(() => {
    if (!value) return null;
    const found = allOptions.find((opt) => opt.value === value);
    if (found) return found;
    return isValidIanaTimeZone(value) ? buildTimeZoneOption(value) : null;
  }, [allOptions, value]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOptions;
    const tokens = q.split(/\s+/).filter(Boolean);
    return allOptions.filter((opt) => tokens.every((t) => opt.searchText.includes(t)));
  }, [allOptions, search]);

  const openMenu = () => {
    if (disabled) return;
    setSearch("");
    const idx = suggestedTimeZone ? 0 : selectedOption ? allOptions.findIndex((opt) => opt.value === selectedOption.value) : 0;
    setActiveIndex(idx >= 0 ? idx : 0);
    setIsOpen(true);
  };

  const closeMenu = () => {
    setIsOpen(false);
    setSearch("");
  };

  const handleSelect = (option: TimeZoneOption) => {
    onChange(option.value);
    closeMenu();
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      closeMenu();
    } else if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      openMenu();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) =>
        filteredOptions.length ? Math.min(prev + 1, filteredOptions.length - 1) : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && isOpen && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const target = filteredOptions[activeIndex];
      if (target) handleSelect(target);
    }
  };

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(`[data-tz-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen, search]);

  return (
    <div className={`relative flex flex-col gap-1.5 hardware-sharp font-body w-full ${isOpen ? "z-[99999]" : ""}`}>
      {label && (
        <div className="flex items-center justify-between">
          <label
            htmlFor={selectId}
            className="field-label cursor-pointer"
            onClick={() => !disabled && openMenu()}
          >
            {label}
          </label>
        </div>
      )}

      <div ref={anchorRef} className="relative">
        <input
          ref={searchInputRef}
          id={selectId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? `${selectId}-options` : undefined}
          aria-activedescendant={isOpen && filteredOptions[activeIndex] ? `${selectId}-option-${activeIndex}` : undefined}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${selectId}-error` : undefined}
          disabled={disabled}
          value={isOpen ? search : selectedOption?.label || value}
          placeholder={isOpen ? "Search city, country, or UTC offset..." : placeholder}
          onClick={() => { if (!isOpen) openMenu(); }}
          onChange={(event) => {
            setSearch(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onKeyDown={handleSearchKeyDown}
          className={`w-full py-2.5 pl-3.5 pr-10 text-sm rounded-xl bg-elevated border border-subtle text-primary placeholder:text-muted outline-none transition-colors hover:border-strong focus:border-strong focus:bg-surface disabled:opacity-50 disabled:cursor-not-allowed ${error ? "border-rose-500/60" : ""}`}
        />
        <button type="button" tabIndex={-1} disabled={disabled}
          aria-label={isOpen ? "Close time zone options" : "Open time zone options"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (isOpen) closeMenu(); else openMenu();
            searchInputRef.current?.focus();
          }}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-secondary hover:text-primary cursor-pointer disabled:cursor-not-allowed">
          <ChevronDown className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      <FloatingMenu
        anchorRef={anchorRef}
        id={`${selectId}-options`}
        open={isOpen}
        onClose={closeMenu}
          align="left"
          matchWidth
          role="listbox"
          aria-label={label}
          style={{ maxHeight: 300, overflowY: "hidden" }}
          className="rounded-2xl bg-surface border border-subtle shadow-2xl p-1.5 z-[99999] hardware-sharp backdrop-blur-xl select-none flex flex-col"
        >
          <div ref={listRef} className="overflow-y-auto flex-1 py-1 max-h-56">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted text-center">
                No matching time zones found.
              </div>
            ) : (
              filteredOptions.map((opt, index) => {
                const isSelected = opt.value === value;
                const isActive = index === activeIndex;
                return (
                  <button
                    key={opt.value}
                    id={`${selectId}-option-${index}`}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-tz-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => handleSelect(opt)}
                    className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-sm text-left transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-elevated text-primary font-medium"
                        : isActive
                        ? "bg-elevated/70 text-primary"
                        : "text-secondary hover:text-primary hover:bg-elevated/60"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      {opt.value === suggestedTimeZone && (
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="context">Suggested</Badge>
                          <span className="text-[11px] text-muted">Your device · Choose if your organization operates here</span>
                        </div>
                      )}
                      <div className="truncate">{opt.label}</div>
                      <div className="text-[11px] text-muted font-mono truncate">{opt.value}</div>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
      </FloatingMenu>

      {error && <FieldError id={`${selectId}-error`}>{error}</FieldError>}
    </div>
  );
}
