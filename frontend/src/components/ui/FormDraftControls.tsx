import { Check, Loader2, RotateCcw, Trash2 } from "lucide-react";
import type { useFormDraft } from "../../hooks/useFormDraft";

export default function FormDraftControls({
  draft,
  busy,
}: {
  draft: ReturnType<typeof useFormDraft>;
  busy?: boolean;
}) {
  const { status, comparison } = draft;
  const label = {
    saving: "Saving…",
    restored: "Draft restored",
    saved: "Draft saved",
    checking: "Checking draft…",
    unavailable: "Could not verify this draft. Reopen the form to retry.",
    stale: "",
    idle: "",
  }[status];

  if (!draft.enabled) return null;

  return (
    <div className="space-y-2 text-xs text-secondary">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-subtle bg-elevated/60 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-medium text-primary">Drafts save automatically</span>

          {label && (
            <span
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                status === "saved"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                  : status === "restored"
                    ? "border-subtle bg-surface text-primary"
                    : status === "unavailable"
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                      : "border-subtle bg-surface text-secondary"
              }`}
            >
              {(status === "saving" || status === "checking") && (
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              )}
              {status === "saved" && <Check className="size-3" aria-hidden="true" />}
              {status === "restored" && <RotateCcw className="size-3" aria-hidden="true" />}
              <span>{label}</span>
            </span>
          )}
        </div>

        {draft.enabled && status !== "idle" && (
          <button
            type="button"
            disabled={busy || status === "checking"}
            onClick={draft.discard}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-subtle bg-surface px-2 py-1 text-[11px] font-medium text-secondary transition-colors hover:border-strong hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2"
          >
            <Trash2 className="size-3" aria-hidden="true" />
            <span>Discard</span>
          </button>
        )}
      </div>

      {draft.enabled && comparison && (
        <details className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <summary className="cursor-pointer font-medium text-primary">
            This record changed since your draft was saved. Review changes
          </summary>
          <dl className="mt-2.5 space-y-2 break-words border-t border-subtle pt-2">
            {Object.entries(comparison.draft)
              .filter(([field, value]) => value !== comparison.current[field])
              .map(([field, value]) => (
                <div key={field} className="rounded-lg bg-surface/60 px-2.5 py-1.5">
                  <dt className="font-medium capitalize text-primary">
                    {field.replace(/([A-Z])/g, " $1")}
                  </dt>
                  <dd className="text-muted">Current: {String(comparison.current[field] || "—")}</dd>
                  <dd className="text-primary">Draft: {String(value || "—")}</dd>
                </div>
              ))}
          </dl>
          <button
            type="button"
            disabled={busy}
            onClick={draft.applyReviewedDraft}
            className="mt-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-action px-3 py-1.5 text-xs font-medium text-action-fg hover:opacity-90 disabled:opacity-50 focus-visible:outline-2"
          >
            Apply reviewed draft
          </button>
        </details>
      )}
    </div>
  );
}
