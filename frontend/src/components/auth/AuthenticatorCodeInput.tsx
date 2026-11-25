import { useId, useRef, useState } from "react";

export default function AuthenticatorCodeInput({ value, onChange, disabled, label = "Authenticator code" }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState(0);

  // A single native input preserves autofill, paste, and keyboard editing.
  return <div className="verification-code" data-disabled={disabled || undefined}>
    <label htmlFor={id} className="sr-only">{label} (6 digits)</label>
    <div className="verification-code-control" onPointerDown={event => {
      if (disabled) return;
      event.preventDefault();
      let index = 0;
      event.currentTarget.querySelectorAll<HTMLElement>(".verification-code-slot").forEach((slot, slotIndex) => {
        if (event.clientX >= slot.getBoundingClientRect().left) index = slotIndex;
      });
      const next = Math.min(index, value.length);
      input.current?.focus();
      input.current?.setSelectionRange(next, next < value.length ? next + 1 : next);
      setPosition(next);
    }}>
    <input
    ref={input}
    id={id}
    className="verification-code-native"
    type="text"
    inputMode="numeric"
    autoComplete="one-time-code"
    maxLength={6}
    pattern="[0-9]{6}"
    required
    value={value}
    disabled={disabled}
    onFocus={() => { setFocused(true); setPosition(input.current?.selectionStart ?? value.length); }}
    onBlur={() => setFocused(false)}
    onSelect={event => setPosition(event.currentTarget.selectionStart ?? value.length)}
    onChange={event => {
      onChange(event.target.value.replace(/\D/g, "").slice(0, 6));
      setPosition(event.target.selectionStart ?? 0);
    }}
    onPaste={event => {
      event.preventDefault();
      const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
      if (digits) { onChange(digits); setPosition(Math.min(digits.length, 5)); }
    }}
    />
    <div aria-hidden="true" className="verification-code-slots">
      {Array.from({ length: 6 }, (_, index) => <span key={index}
        className="verification-code-slot"
        data-active={focused && !disabled && index === Math.min(position, value.length, 5) || undefined}>
        {value[index] || <span className="verification-code-caret" />}
      </span>)}
    </div>
    </div>
  </div>;
}
