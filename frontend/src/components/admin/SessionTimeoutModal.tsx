import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Timer, X } from "lucide-react";
import type { PlatformSessionTimeoutSetting } from "../../lib/api";
import {
  isValidDurationSeconds,
  MAX_DURATION_SECONDS,
  MIN_ACTIVE_DURATION_SECONDS,
} from "../../utils/duration";
import DurationHybridInput, {
  type DurationPreset,
} from "./DurationHybridInput";

const IDLE_PRESETS: DurationPreset[] = [
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3_600 },
  { label: "24h", seconds: 86_400 },
];

const ABSOLUTE_PRESETS: DurationPreset[] = [
  { label: "12h", seconds: 43_200 },
  { label: "1d", seconds: 86_400 },
  { label: "7d", seconds: 604_800 },
  { label: "30d", seconds: 2_592_000 },
];

export interface SessionTimeoutSavePayload {
  idleSeconds: number;
  absoluteSeconds: number;
  superAdminExempt: boolean;
  reason: string;
}

export interface SessionTimeoutModalProps {
  open: boolean;
  savedPolicy: PlatformSessionTimeoutSetting;
  isSaving: boolean;
  onClose: () => void;
  onSave: (payload: SessionTimeoutSavePayload) => void;
}

export default function SessionTimeoutModal({
  open,
  savedPolicy,
  isSaving,
  onClose,
  onSave,
}: SessionTimeoutModalProps) {
  const [idleSeconds, setIdleSeconds] = useState(savedPolicy.idle_seconds);
  const [absoluteSeconds, setAbsoluteSeconds] = useState(
    savedPolicy.absolute_seconds,
  );
  const [superAdminExempt, setSuperAdminExempt] = useState(
    savedPolicy.super_admin_exempt,
  );
  const [reason, setReason] = useState("");
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const touchStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isSaving, onClose]);

  if (!open) return null;

  const idleValid = isValidDurationSeconds(idleSeconds);
  const absoluteValid = isValidDurationSeconds(absoluteSeconds);

  const idleError = !idleValid
    ? `Must be 0 (disabled) or between ${MIN_ACTIVE_DURATION_SECONDS} seconds and 30 days (${MAX_DURATION_SECONDS.toLocaleString()}s).`
    : undefined;
  const absoluteError = !absoluteValid
    ? `Must be 0 (disabled) or between ${MIN_ACTIVE_DURATION_SECONDS} seconds and 30 days (${MAX_DURATION_SECONDS.toLocaleString()}s).`
    : undefined;

  const idleExceedsAbsolute =
    idleSeconds > 0 &&
    absoluteSeconds > 0 &&
    idleSeconds > absoluteSeconds;

  const isDirty =
    idleSeconds !== savedPolicy.idle_seconds ||
    absoluteSeconds !== savedPolicy.absolute_seconds ||
    superAdminExempt !== savedPolicy.super_admin_exempt;

  const trimmedReason = reason.trim();
  const reasonValid = !isDirty || trimmedReason.length >= 3;
  const canSave =
    isDirty && idleValid && absoluteValid && trimmedReason.length >= 3 && !isSaving;

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (isSaving) return;
    touchStartYRef.current = event.touches[0].clientY;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current === null || isSaving) return;
    const delta = event.touches[0].clientY - touchStartYRef.current;
    if (delta > 0) {
      setDragOffsetY(delta);
    }
  };

  const handleTouchEnd = () => {
    if (dragOffsetY > 90 && !isSaving) {
      onClose();
    }
    setDragOffsetY(0);
    touchStartYRef.current = null;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    onSave({
      idleSeconds,
      absoluteSeconds,
      superAdminExempt,
      reason: trimmedReason,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 sm:p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-timeout-modal-title"
        style={
          dragOffsetY > 0
            ? { transform: `translateY(${dragOffsetY}px)` }
            : undefined
        }
        className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl max-h-[92dvh] flex flex-col transition-transform duration-150"
      >
        {/* Mobile drag handle */}
        <div
          className="sm:hidden flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <span className="h-1 w-10 rounded-full bg-zinc-700" aria-hidden="true" />
        </div>

        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-5 pt-3 sm:pt-5 pb-4 border-b border-zinc-800"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-emerald-400">
              <Timer className="w-4 h-4" />
            </span>
            <div>
              <h3
                id="session-timeout-modal-title"
                className="text-sm font-semibold text-zinc-100"
              >
                Configure Session Timeout Policy
              </h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                Idle time starts at last activity. Absolute time starts at sign-in.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            disabled={isSaving}
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="px-5 py-4 space-y-5 overflow-y-auto">
            <DurationHybridInput
              label="Idle timeout"
              value={idleSeconds}
              onChange={setIdleSeconds}
              presets={IDLE_PRESETS}
              defaultEnabledSeconds={900}
              error={idleError}
            />

            <DurationHybridInput
              label="Absolute timeout"
              value={absoluteSeconds}
              onChange={setAbsoluteSeconds}
              presets={ABSOLUTE_PRESETS}
              defaultEnabledSeconds={86_400}
              error={absoluteError}
            />

            {idleExceedsAbsolute && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200"
              >
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Idle timeout exceeds absolute timeout — active sessions will still
                  expire at the absolute deadline first.
                </span>
              </div>
            )}

            {/* Super Admin Exemption Toggle */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3">
              <div className="space-y-0.5">
                <span className="block text-xs font-medium text-zinc-200">
                  Exempt super admins from both deadlines
                </span>
                <span className="block text-[11px] text-zinc-400">
                  Platform super administrators bypass idle and absolute session limits.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={superAdminExempt}
                aria-label="Exempt super admins from both deadlines"
                onClick={() => setSuperAdminExempt((prev) => !prev)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                  superAdminExempt
                    ? "border-emerald-500/50 bg-emerald-600"
                    : "border-zinc-700 bg-zinc-800"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
                    superAdminExempt ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {/* Audit Reason (required when dirty) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="session-timeout-audit-reason"
                  className="text-xs font-medium text-zinc-200"
                >
                  Audit reason{" "}
                  {isDirty ? (
                    <span className="text-emerald-400">*</span>
                  ) : (
                    <span className="text-zinc-500 font-normal">(required on change)</span>
                  )}
                </label>
                {isDirty && (
                  <span className="text-[11px] text-zinc-500 font-mono">
                    {trimmedReason.length}/500
                  </span>
                )}
              </div>
              <input
                id="session-timeout-audit-reason"
                type="text"
                minLength={3}
                maxLength={500}
                required={isDirty}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Align idle timeout with SOC2 15-minute policy"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30"
              />
              {isDirty && trimmedReason.length > 0 && !reasonValid && (
                <p className="text-[11px] text-amber-400">
                  Enter at least 3 characters for the audit log.
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-zinc-800 bg-zinc-900/95 rounded-b-2xl">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving..." : "Save Policy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
