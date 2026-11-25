import { SlidersHorizontal, Timer } from "lucide-react";
import type { PlatformSessionTimeoutSetting } from "../../lib/api";
import { formatDurationSummary } from "../../utils/duration";
import { formatErrorMessage } from "../../utils/formatError";

export interface SessionTimeoutBannerProps {
  savedPolicy: PlatformSessionTimeoutSetting | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isSuperAdmin: boolean;
  onRetry: () => void;
  onConfigure: () => void;
}

export default function SessionTimeoutBanner({
  savedPolicy,
  isPending,
  isError,
  error,
  isSuperAdmin,
  onRetry,
  onConfigure,
}: SessionTimeoutBannerProps) {
  return (
    <section className="admin-card px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
      <div className="flex items-start gap-2.5 text-secondary min-w-0">
        <Timer className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5 min-w-0">
          <p className="text-primary font-medium">Session Timeout Policy</p>

          {isPending && (
            <p className="text-[11px] text-secondary">Loading policy…</p>
          )}

          {isError && (
            <p role="alert" className="text-[11px] text-rose-400">
              {formatErrorMessage(error)}{" "}
              <button
                type="button"
                onClick={onRetry}
                className="underline hover:text-rose-300 cursor-pointer"
              >
                Retry
              </button>
            </p>
          )}

          {savedPolicy && (
            <>
              <p className="text-[11px] text-secondary flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span>
                  Saved idle:{" "}
                  <strong className="text-primary font-medium">
                    {formatDurationSummary(savedPolicy.idle_seconds)}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Saved absolute:{" "}
                  <strong className="text-primary font-medium">
                    {formatDurationSummary(savedPolicy.absolute_seconds)}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Super admin exemption:{" "}
                  <strong className="text-primary font-medium">
                    {savedPolicy.super_admin_exempt ? "On" : "Off"}
                  </strong>
                </span>
              </p>

              {savedPolicy.updated_reason && (
                <p className="text-[11px] text-muted truncate">
                  Last update reason · {savedPolicy.updated_reason}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {isSuperAdmin && savedPolicy && (
        <button
          type="button"
          onClick={onConfigure}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer shrink-0 self-start lg:self-auto"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
          Configure Policy
        </button>
      )}
    </section>
  );
}
