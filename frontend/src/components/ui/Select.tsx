import { FieldError, RequiredMark } from "./FieldFeedback";
import FloatingMenu from "./FloatingMenu";
import React, { useState, useRef, useEffect, useId, useMemo } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  label?: string;
  labelClassName?: string;
  ariaLabel?: string;
  error?: string;
  icon?: React.ReactNode;
  options?: SelectOption[];
  children?: React.ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  buttonClassName?: string;
  selectSize?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'pill' | 'minimal';
  align?: 'left' | 'right';
  menuWidth?: 'auto' | 'full' | string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  labelClassName = "",
  ariaLabel,
  error,
  icon,
  options,
  children,
  value,
  defaultValue,
  onChange,
  onValueChange,
  placeholder = 'Select an option',
  disabled = false,
  required = false,
  name,
  id,
  className = '',
  buttonClassName = '',
  selectSize = 'md',
  variant = 'default',
  align = 'left',
  menuWidth = 'full',
}) => {
  const generatedId = useId();
  const selectId = id || generatedId;
  const containerRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);

  // Extract options from props or children
  const parsedOptions: SelectOption[] = useMemo(() => {
    if (options && options.length > 0) return options;
    if (!children) return [];

    const extracted: SelectOption[] = [];
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && child.props) {
        const childProps = child.props as {
          value?: string | number;
          disabled?: boolean;
          children?: React.ReactNode;
        };
        const optVal = childProps.value;
        const optDisabled = childProps.disabled;
        const optLabel = childProps.children;
        if (optVal !== undefined) {
          extracted.push({
            value: optVal,
            label: typeof optLabel === 'string' ? optLabel : String(optLabel ?? optVal),
            disabled: Boolean(optDisabled),
          });
        }
      }
    });
    return extracted;
  }, [options, children]);

  // Internal value management for uncontrolled or controlled usage
  const [internalValue, setInternalValue] = useState<string>(() => {
    if (value !== undefined) return String(value);
    if (defaultValue !== undefined) return String(defaultValue);
    return parsedOptions.length > 0 && !placeholder ? String(parsedOptions[0].value) : '';
  });

  const activeValue = value !== undefined ? String(value) : internalValue;

  const selectedOption = parsedOptions.find(
    (opt) => String(opt.value) === String(activeValue)
  );

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

  const handleSelect = (optValue: string | number) => {
    const strVal = String(optValue);
    setInternalValue(strVal);
    setIsOpen(false);

    if (onValueChange) {
      onValueChange(strVal);
    }

    if (onChange) {
      const syntheticEvent = {
        target: { value: strVal, name: name || id || '' },
        currentTarget: { value: strVal, name: name || id || '' },
        value: strVal,
        toString: () => strVal,
        valueOf: () => strVal,
      };
      (onChange as (e: { target: { value: string; name?: string } }) => void)(syntheticEvent);
    }
  };

  // Keyboard navigation within the dropdown
  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    }
  };

  // Sizing definitions
  const sizeClasses = {
    sm: variant === 'pill'
      ? 'py-1.5 px-3 text-xs rounded-full gap-1.5'
      : 'py-2 px-3 text-xs rounded-xl gap-2',
    md: variant === 'pill'
      ? 'py-2 px-3.5 text-sm rounded-full gap-2'
      : 'py-2.5 px-3.5 text-sm rounded-xl gap-2.5',
    lg: variant === 'pill'
      ? 'py-2.5 px-4 text-sm rounded-full gap-2.5'
      : 'py-3.5 px-4.5 text-sm rounded-2xl gap-3',
  }[selectSize];

  // Visual appearance styles
  const variantClasses = {
    default:
      'bg-elevated border border-subtle hover:border-strong focus:border-border-strong focus:bg-surface text-primary',
    pill:
      'bg-surface border border-subtle hover:border-strong text-secondary hover:text-primary',
    minimal:
      'bg-transparent hover:bg-elevated border border-transparent hover:border-subtle text-secondary hover:text-primary',
  }[variant];

  // Popover menu width
  const intrinsicMenu = variant === 'pill' || menuWidth === 'auto';
  const menuAlign = intrinsicMenu ? 'right' : align;
  const menuWidthClass =
    intrinsicMenu ? 'min-w-[180px] w-max' :
    menuWidth === 'full'
      ? 'w-full'
      : menuWidth === 'auto'
      ? 'min-w-[180px] w-auto'
      : menuWidth;

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
      {label && (
        <div className="flex items-center justify-between">
          <label
            htmlFor={selectId}
            className={labelClassName || "field-label cursor-pointer"}
            onClick={() => !disabled && setIsOpen(true)}
          >
            {label}
            {required && <RequiredMark />}
          </label>
        </div>
      )}

      {/* Hidden Native Input for standard Form Submissions */}
      {name && <input type="hidden" name={name} value={activeValue} />}

      {/* Trigger Button */}
      <button
        id={selectId}
        role="combobox"
        aria-required={required || undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${selectId}-error` : undefined}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`group flex items-center justify-between transition-all text-left cursor-pointer outline-none focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-border-subtle ${variantClasses} ${sizeClasses} ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${error ? 'border-rose-500/60!' : isOpen ? 'border-strong ring-1 ring-border-subtle' : ''} ${buttonClassName}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="shrink-0 text-secondary group-hover:text-primary">{icon}</span>}
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span
            className={`truncate font-body ${
              selectedOption ? 'text-primary font-normal' : 'text-muted'
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-secondary group-hover:text-primary transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-primary' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu Popover */}
      <FloatingMenu open={isOpen} onClose={() => setIsOpen(false)} align={menuAlign} matchWidth={!intrinsicMenu && menuWidth === 'full'}
          role="listbox"
          aria-label={ariaLabel || label || placeholder}
          className={`absolute top-full mt-1.5 ${menuWidthClass} rounded-2xl bg-surface border border-subtle shadow-2xl p-1.5 z-[99999] hardware-sharp backdrop-blur-xl select-none max-h-60 overflow-y-auto ${
            menuAlign === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {parsedOptions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted text-center font-mono">
              No options available
            </div>
          ) : (
            parsedOptions.map((opt) => {
              const isSelected = String(opt.value) === String(activeValue);
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onClick={() => !opt.disabled && handleSelect(opt.value)}
                  className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-sm text-left transition-colors cursor-pointer ${
                    opt.disabled
                      ? 'opacity-40 cursor-not-allowed text-muted'
                      : isSelected
                      ? 'bg-elevated text-primary font-medium'
                      : 'text-secondary hover:text-primary hover:bg-elevated/70'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                    <div className="min-w-0">
                      <div className={intrinsicMenu ? "whitespace-nowrap" : "break-words"}>{opt.label}</div>
                      {opt.description && (
                        <div className="text-[10px] text-muted font-mono">
                          {opt.description}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-1.5" />
                  )}
                </button>
              );
            })
          )}
      </FloatingMenu>
      {error && <FieldError id={`${selectId}-error`}>{error}</FieldError>}
    </div>
  );
};

export default Select;
