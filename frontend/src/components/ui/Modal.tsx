import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ModalMaxWidth =
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl"
  | (string & {});

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: ModalMaxWidth;
  className?: string;
  labelledBy?: string;
  mobileFullScreen?: boolean;
}

const SIZE_MAP: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  maxWidth = "lg",
  className = "",
  labelledBy,
  mobileFullScreen = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const manageFocus = Boolean(labelledBy);

  useEffect(() => {
    if (!isOpen || !manageFocus) return;
    const previousFocus = document.activeElement;
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [isOpen, manageFocus]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass = SIZE_MAP[maxWidth] ?? maxWidth;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={`fixed inset-0 z-[9999] min-h-[100dvh] h-[100dvh] w-screen flex items-center justify-center ${
        mobileFullScreen ? "p-0 sm:p-6" : "p-4 sm:p-6"
      } overflow-y-auto bg-black/50 dark:bg-black/70 backdrop-blur-xs animate-modal-backdrop`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        tabIndex={labelledBy ? -1 : undefined}
        onKeyDown={event => {
          if (!labelledBy || event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button, input, textarea, select, a[href], [tabindex]',
          )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length);
          const first = controls[0];
          const last = controls.at(-1);
          const active = document.activeElement;
          if (!controls.some(control => control === active) || (event.shiftKey ? active === first : active === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          }
        }}
        className={`bg-surface modal-surface relative m-auto w-full ${maxWidthClass} ${
          mobileFullScreen
            ? "max-sm:min-h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none max-sm:border-0 sm:rounded-2xl sm:max-h-[90dvh]"
            : "rounded-xl max-h-[90dvh]"
        } border border-subtle p-6 shadow-xl dark:shadow-2xl overflow-y-auto hardware-sharp animate-modal-panel ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
