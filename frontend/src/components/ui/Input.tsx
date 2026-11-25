import { FieldError, RequiredMark } from "./FieldFeedback";
import React, { useId, useState } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  labelHint?: string;
  icon?: React.ReactNode;
  error?: string;
  validationMessage?: string;
  visibilityLabel?: string;
  rightAdornment?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  labelHint,
  icon,
  error: externalError,
  validationMessage,
  visibilityLabel = 'password',
  rightAdornment,
  onBlur,
  onChange,
  id,
  required,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  type = 'text',
  className = '',
  ...props
}) => {
  const [touched, setTouched] = useState(false);
  const [nativeError, setNativeError] = useState("");
  const getConstraintError = (field: HTMLInputElement) => {
    const fieldName = label?.toLowerCase();
    if (field.validity.valueMissing) return fieldName ? `Enter ${fieldName}.` : "Enter a value.";
    if (field.validity.typeMismatch && type === "email") return "Enter a valid email address.";
    if (field.validity.badInput) return "Enter a valid number.";
    if (field.validity.rangeUnderflow) return `Enter a value of ${field.min} or more.`;
    if (field.validity.rangeOverflow) return `Enter a value of ${field.max} or less.`;
    if (field.validity.stepMismatch) return "Enter a value in the required increments.";
    return field.validity.valid ? "" : field.validationMessage;
  };
  const error = externalError || (touched ? validationMessage || nativeError : undefined);
  const [showPassword, setShowPassword] = useState(false);
  const isPasswordType = type === 'password';

  const generatedId = useId();
  const inputId = id || generatedId;
  const actualType = isPasswordType ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="flex flex-col gap-1.5 w-full relative hardware-sharp group font-body font-normal">
      {/* Field Label matching reference design (clean Title Case, Geist regular) */}
      {label && (
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={inputId}
            className="field-label"
          >
            {label}{required && <RequiredMark />}
          </label>
          {labelHint && (
            <span className="group/hint relative inline-flex">
              <button type="button" aria-label={`Information about ${label}`} aria-describedby={`${inputId}-hint`} className="cursor-help rounded-full p-1 text-zinc-500 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-zinc-400">
                <Info className="size-3" aria-hidden="true" />
              </button>
              <span role="tooltip" id={`${inputId}-hint`} className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-2 w-48 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-300 opacity-0 transition-opacity group-hover/hint:opacity-100 group-focus-within/hint:opacity-100">{labelHint}</span>
            </span>
          )}
        </div>
      )}

      {/* Input Field Container */}
      <div className="relative flex items-center w-full">
        {/* Left Field Icon (if provided) */}
        {icon && (
          <div className="absolute left-4 text-muted group-focus-within:text-primary transition-colors pointer-events-none z-10 shrink-0">
            {icon}
          </div>
        )}

        {/* HTML Input Element with rounded-2xl geometry matching mobile layout */}
        <input
          id={inputId}
          required={required}
          data-validation-message={validationMessage}
          onBlur={event => {
            setTouched(true);
            setNativeError(getConstraintError(event.currentTarget));
            onBlur?.(event);
          }}
          onChange={event => {
            if (touched) setNativeError(getConstraintError(event.currentTarget));
            onChange?.(event);
          }}
          aria-required={required || undefined}
          aria-invalid={error ? true : invalid}
          aria-describedby={[describedBy, error && `${inputId}-error`].filter(Boolean).join(" ") || undefined}
          type={actualType}
          className={`bg-elevated border border-subtle hover:border-strong text-primary rounded-2xl ${
            icon ? 'pl-11' : 'pl-4.5'
          } ${isPasswordType ? 'pr-11' : 'pr-4.5'} py-3.5 text-sm focus:border-border-strong focus:ring-2 focus:ring-border-subtle focus:outline-none outline-none transition-all w-full placeholder:text-muted hardware-sharp font-body font-normal ${error ? "border-rose-500/60!" : ""} ${className}`}
          {...props}
          onInvalid={event => {
            event.preventDefault();
            setTouched(true);
            const field = event.currentTarget;
            setNativeError(getConstraintError(field));
            if (field.form?.querySelector(":invalid:is(input, select, textarea)") === field) field.focus();
            props.onInvalid?.(event);
          }}
        />

        {/* Right Password Visibility Toggle Icon */}
        {isPasswordType ? (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3.5 text-secondary hover:text-primary transition-colors cursor-pointer p-1 z-10 rounded focus-visible:ring-2 focus-visible:ring-zinc-400"
            title={`${showPassword ? 'Hide' : 'Show'} ${visibilityLabel}`}
            aria-label={`${showPassword ? 'Hide' : 'Show'} ${visibilityLabel}`}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        ) : rightAdornment ? (
          <div className="absolute right-3.5 z-10 flex items-center">
            {rightAdornment}
          </div>
        ) : null}
      </div>
      {error && <FieldError id={`${inputId}-error`}>{error}</FieldError>}
    </div>
  );
};

export default Input;
