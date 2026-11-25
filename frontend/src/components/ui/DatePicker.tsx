import { FieldError, RequiredMark } from "./FieldFeedback";
import FloatingMenu from "./FloatingMenu";
import React, { useState, useRef, useEffect, useId } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface DatePickerProps {
  label?: string;
  optional?: boolean;
  yearRange?: { from: number; to: number };
  error?: string;
  value?: string; // ISO format "YYYY-MM-DD"
  onChange?: (date: string) => void;
  placeholder?: string;
  min?: string; // "YYYY-MM-DD"
  max?: string; // "YYYY-MM-DD"
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'pill';
  allowClear?: boolean;
  align?: 'left' | 'right';
  typeable?: boolean;
  ariaLabel?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function formatIsoDisplay(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return isoDate;
  const d = new Date(year, month, day);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isValidIsoDate(isoDate: string, min?: string, max?: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const [yStr, mStr, dStr] = isoDate.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10) - 1;
  const d = parseInt(dStr, 10);
  const parsed = new Date(y, m, d);
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m || parsed.getDate() !== d) return false;
  if (min && isoDate < min) return false;
  if (max && isoDate > max) return false;
  return true;
}

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  label,
  optional = false,
  yearRange,
  error,
  value = '',
  onChange,
  placeholder = 'Select date',
  min,
  max,
  disabled = false,
  required = false,
  id,
  name,
  className = '',
  size = 'md',
  variant = 'default',
  allowClear = true,
  align = 'left',
  typeable,
  ariaLabel,
}) => {
  const isTypeable = typeable ?? variant === 'default';
  const generatedId = useId();
  const pickerId = id || generatedId;
  const containerRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [draftText, setDraftText] = useState(value);

  // View state for the calendar (month: 0-11, year: number)
  const initialDate = value ? new Date(value) : new Date();
  const [viewYear, setViewYear] = useState(() =>
    isNaN(initialDate.getTime()) ? new Date().getFullYear() : initialDate.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState(() =>
    isNaN(initialDate.getTime()) ? new Date().getMonth() : initialDate.getMonth()
  );

  // Synchronize view state when value prop changes
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!isFocused) setDraftText(value);
    if (value) {
      const parts = value.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        if (!isNaN(y) && !isNaN(m)) {
          setViewYear(y);
          setViewMonth(m);
        }
      }
    }
  }

  // Click outside and escape key listener
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((prev) => prev - 1);
    } else {
      setViewMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((prev) => prev + 1);
    } else {
      setViewMonth((prev) => prev + 1);
    }
  };

  const handleSelectDate = (dateIso: string) => {
    setDraftText(dateIso);
    onChange?.(dateIso);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftText('');
    onChange?.('');
  };

  const handleToday = (e: React.MouseEvent) => {
    e.stopPropagation();
    const todayIso = getTodayIso();
    if ((min && todayIso < min) || (max && todayIso > max)) return;
    setDraftText(todayIso);
    onChange?.(todayIso);
    setIsOpen(false);
  };

  // Calendar calculations
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sunday
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const prevMonthPaddingDays: number[] = [];
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    prevMonthPaddingDays.push(daysInPrevMonth - i);
  }

  const currentMonthDays: number[] = [];
  for (let i = 1; i <= daysInMonth; i++) {
    currentMonthDays.push(i);
  }

  const totalDisplayed = prevMonthPaddingDays.length + currentMonthDays.length;
  const remainingCells = (7 - (totalDisplayed % 7)) % 7;
  const nextMonthPaddingDays: number[] = [];
  for (let i = 1; i <= remainingCells; i++) {
    nextMonthPaddingDays.push(i);
  }

  const todayIso = getTodayIso();
  const displayLabel = value ? formatIsoDisplay(value) : placeholder;

  // Sizing definitions
  const sizeClasses = {
    sm: variant === 'pill'
      ? 'py-1.5 px-3 text-xs rounded-full'
      : 'py-2 px-3 text-xs rounded-xl',
    md: variant === 'pill'
      ? 'py-2 px-3.5 text-xs sm:text-sm rounded-full'
      : 'py-2.5 px-3.5 text-sm rounded-xl',
    lg: variant === 'pill'
      ? 'py-2.5 px-4 text-sm rounded-full'
      : 'py-3.5 px-4.5 text-sm rounded-2xl',
  }[size];

  const triggerBaseClasses = variant === 'pill'
    ? 'bg-surface border border-subtle hover:border-strong text-secondary hover:text-primary'
    : 'bg-elevated border border-subtle hover:border-strong focus:border-border-strong focus:bg-surface text-primary placeholder:text-muted';

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col gap-1.5 hardware-sharp font-body ${
        isOpen ? 'z-[99999]' : ''
      } ${
        variant === 'pill' ? 'w-auto' : 'w-full'
      } ${className}`}
    >
      {/* Optional Form Field Label */}
      {optional && <span className="text-[10px] text-zinc-500">(optional)</span>}
      {label && (
        <div className="flex items-center justify-between">
          <label
            htmlFor={pickerId}
            className="field-label font-body text-xs sm:text-sm text-secondary font-normal cursor-pointer"
            onClick={() => !disabled && setIsOpen(true)}
          >
            {label}
            {required && <RequiredMark />}
          </label>
        </div>
      )}

      {/* Hidden Native Input for standard Form Submissions */}
      {name && <input type="hidden" name={name} value={value} />}

      {/* Trigger */}
      {isTypeable ? (
        <div
          className={`group flex items-center justify-between gap-2 transition-all ${triggerBaseClasses} ${sizeClasses} ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          } ${error ? 'border-rose-500/60!' : isOpen || isFocused ? 'border-strong ring-1 ring-border-subtle' : ''}`}
        >
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsOpen((prev) => !prev)}
              aria-label="Open calendar"
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              className="shrink-0 cursor-pointer rounded-md p-0.5 text-muted transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-border-strong disabled:cursor-not-allowed"
            >
              <CalendarIcon className={`w-4 h-4 ${value ? 'text-primary' : 'text-muted group-hover:text-secondary'}`} />
            </button>
            <input
              id={pickerId}
              type="text"
              role="combobox"
              aria-label={ariaLabel}
              aria-required={required || undefined}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? `${pickerId}-error` : undefined}
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              disabled={disabled}
              inputMode="numeric"
              maxLength={10}
              placeholder={isFocused ? 'YYYY-MM-DD' : (placeholder === 'Select date' ? 'YYYY-MM-DD' : placeholder)}
              value={isFocused ? draftText : (value ? formatIsoDisplay(value) : '')}
              onFocus={() => {
                setIsFocused(true);
                setDraftText(value);
              }}
              onChange={(e) => {
                const next = e.target.value;
                setDraftText(next);
                if (next === '' && allowClear) {
                  onChange?.('');
                } else if (isValidIsoDate(next, min, max)) {
                  onChange?.(next);
                }
              }}
              onBlur={() => {
                setIsFocused(false);
                const trimmed = draftText.trim();
                if (trimmed === '' && allowClear) {
                  onChange?.('');
                  setDraftText('');
                } else if (isValidIsoDate(trimmed, min, max)) {
                  onChange?.(trimmed);
                  setDraftText(trimmed);
                } else {
                  setDraftText(value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && !isOpen) {
                  e.preventDefault();
                  setIsOpen(true);
                }
              }}
              className="w-full min-w-0 bg-transparent font-body text-primary placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
            />
          </div>

          {allowClear && value && !disabled ? (
            <button
              type="button"
              onClick={handleClear}
              title="Clear date"
              aria-label="Clear date"
              className="p-1 rounded-md text-muted hover:text-primary hover:bg-elevated transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsOpen((prev) => !prev)}
              aria-label="Toggle calendar"
              className="text-muted group-hover:text-secondary transition-colors text-xs font-mono shrink-0 cursor-pointer px-0.5 disabled:cursor-not-allowed"
            >
              ▾
            </button>
          )}
        </div>
      ) : (
        <button
          id={pickerId}
          role="combobox"
          aria-label={ariaLabel}
          aria-required={required || undefined}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${pickerId}-error` : undefined}
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          className={`group flex items-center justify-between gap-2.5 transition-all text-left cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-border-strong ${triggerBaseClasses} ${sizeClasses} ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          } ${error ? 'border-rose-500/60!' : isOpen ? 'border-strong ring-1 ring-border-subtle' : ''}`}
        >
          <div className="flex items-center gap-2.5 truncate min-w-0">
            <CalendarIcon
              className={`w-4 h-4 shrink-0 transition-colors ${
                value ? 'text-primary' : 'text-muted group-hover:text-secondary'
              }`}
            />
            <span className={`truncate font-body ${value ? 'text-primary font-medium' : 'text-muted font-normal'}`}>
              {displayLabel}
            </span>
          </div>

          {/* Clear Button or Chevron */}
          {allowClear && value && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClear(e as unknown as React.MouseEvent);
                }
              }}
              title="Clear date"
              className="p-1 rounded-md text-muted hover:text-primary hover:bg-elevated transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          ) : (
            <span className="text-muted group-hover:text-secondary transition-colors text-xs font-mono shrink-0">
              {value ? '' : '▾'}
            </span>
          )}
        </button>
      )}

      {/* Calendar Popover */}
      <FloatingMenu open={isOpen} onClose={() => setIsOpen(false)} align={align}
        role="dialog"
        aria-label="Date Picker Calendar"
        className={`absolute top-full mt-2 w-72 sm:w-80 rounded-2xl bg-surface border border-subtle shadow-2xl p-4 z-[99999] hardware-sharp backdrop-blur-xl select-none ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
          {/* Calendar Header: Month, Year, and Nav Arrows */}
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-subtle">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-xl text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
              title="Previous month"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 font-heading font-medium text-sm text-primary">
              {yearRange ? <>
                <select aria-label="Birth month" value={viewMonth} onChange={event => setViewMonth(Number(event.target.value))} className="select-no-arrow cursor-pointer rounded bg-elevated px-1 py-1 text-xs text-primary">
                  {MONTH_NAMES.map((month, index) => <option key={month} value={index}>{month}</option>)}
                </select>
                <select aria-label="Birth year" value={viewYear} onChange={event => setViewYear(Number(event.target.value))} className="select-no-arrow cursor-pointer rounded bg-elevated px-1 py-1 text-xs text-primary">
                  {Array.from({ length: yearRange.to - yearRange.from + 1 }, (_, index) => yearRange.to - index).map(year => <option key={year} value={year}>{year}</option>)}
                </select>
              </> : <>
              <span>{MONTH_NAMES[viewMonth]}</span>
              <span className="text-secondary font-mono text-xs">{viewYear}</span>
              </>}
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-xl text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
              title="Next month"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Days of Week Header */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {DAYS_OF_WEEK.map((d) => (
              <span
                key={d}
                className="text-[11px] font-mono text-muted uppercase tracking-wider py-1 font-medium"
              >
                {d}
              </span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Previous Month Padding */}
            {prevMonthPaddingDays.map((d) => (
              <span
                key={`prev-${d}`}
                className="text-xs text-muted/40 py-2 text-center rounded-xl font-body"
              >
                {d}
              </span>
            ))}

            {/* Current Month Active Days */}
            {currentMonthDays.map((dayNum) => {
              const mStr = String(viewMonth + 1).padStart(2, '0');
              const dStr = String(dayNum).padStart(2, '0');
              const cellIso = `${viewYear}-${mStr}-${dStr}`;

              const isSelected = value === cellIso;
              const isToday = cellIso === todayIso;
              const isDisabled = Boolean(
                (min && cellIso < min) || (max && cellIso > max)
              );

              return (
                <button
                  key={cellIso}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleSelectDate(cellIso)}
                  className={`text-xs py-2 rounded-xl transition-all font-body text-center cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-500 text-black font-semibold shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                      : isToday
                      ? 'text-emerald-700 dark:text-zinc-200 bg-emerald-500/15 dark:bg-emerald-950/40 border border-emerald-500/30 dark:border-emerald-800/60 font-medium hover:bg-emerald-500/25'
                      : isDisabled
                      ? 'text-muted/40 cursor-not-allowed opacity-40'
                      : 'text-secondary hover:text-primary hover:bg-elevated'
                  }`}
                >
                  {dayNum}
                </button>
              );
            })}

            {/* Next Month Padding */}
            {nextMonthPaddingDays.map((d) => (
              <span
                key={`next-${d}`}
                className="text-xs text-muted/40 py-2 text-center rounded-xl font-body"
              >
                {d}
              </span>
            ))}
          </div>

          {/* Quick Action Footer: Clear & Today */}
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-subtle text-xs">
            {allowClear ? (
              <button
                type="button"
                onClick={handleClear}
                disabled={!value}
                className="text-muted hover:text-primary font-mono text-[11px] disabled:opacity-30 cursor-pointer"
              >
                Clear
              </button>
            ) : <span />}

            <button
              type="button"
              onClick={handleToday}
              className="text-primary hover:text-emerald-600 dark:hover:text-emerald-300 font-mono text-[11px] font-medium cursor-pointer flex items-center gap-1 hover:underline"
            >
              Today
            </button>
          </div>
      </FloatingMenu>
      {error && <FieldError id={`${pickerId}-error`}>{error}</FieldError>}
    </div>
  );
};

export default DatePicker;
