import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, LoaderCircle } from "lucide-react";
import API from "../../config/apiClient";
import { extractApiErrorDetails } from "../../config/sessionRecovery";
import { normalizeUsername, scheduleUsernameCheck, validUsernameCandidate } from "../../lib/usernameAvailability";
import Input from "../ui/Input";

export default function UsernameAvailability({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId();
  const [result, setResult] = useState<{ candidate: string; available?: boolean; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const cooldown = useRef(0);
  const valid = validUsernameCandidate(value);
  const candidate = normalizeUsername(value);

  useEffect(() => {
    if (!valid) return;
    return scheduleUsernameCheck(value, async (username, signal) => {
      if (Date.now() < cooldown.current) throw new Error("cooldown");
      return (await API.post<{ available: boolean }>("/auth/username-availability", { username }, { signal })).data.available;
    }, outcome => {
      if ("error" in outcome) {
        const details = extractApiErrorDetails(outcome.error);
        if (details.status === 429) cooldown.current = Date.now() + (details.retryAfterSeconds ?? 60) * 1000;
        setResult({
          candidate,
          error: Date.now() < cooldown.current
            ? "Too many checks. Wait to retry."
            : "Check failed.",
        });
      } else {
        setResult({ candidate, available: outcome.available });
      }
    });
  }, [value, candidate, valid, retry]);

  const current = result?.candidate === candidate ? result : null;
  const checking = valid && !current;
  const statusText = !value
    ? ""
    : !valid
      ? "6–20 chars"
      : checking
        ? "Checking"
        : current?.error
          ? "Retry"
          : current?.available
            ? "Available"
            : "Taken";

  const toneClass = current?.available && valid
    ? "text-emerald-400"
    : current?.available === false && valid
      ? "text-rose-400"
      : "text-zinc-400";

  const Icon = checking ? LoaderCircle : current?.available ? CheckCircle2 : AlertCircle;

  const indicator = !statusText ? null : current?.error ? (
    <button
      type="button"
      id={`${id}-availability`}
      onClick={() => { setResult(null); setRetry(count => count + 1); }}
      title={current.error}
      className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-amber-400 underline underline-offset-2 hover:text-white"
    >
      <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />
      <span>Retry</span>
    </button>
  ) : (
    <span
      id={`${id}-availability`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={!valid ? "Use 6–20 letters or digits, starting with a letter." : undefined}
      className={`pointer-events-none inline-flex items-center gap-1 text-[11px] font-medium ${toneClass}`}
    >
      <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${checking ? "animate-spin motion-reduce:animate-none" : ""}`} />
      <span>{statusText}</span>
    </span>
  );

  return (
    <Input
      id={id}
      label="Username"
      placeholder="donjuan"
      icon={<span aria-hidden="true" className="text-sm font-body select-none">@</span>}
      rightAdornment={indicator}
      validationMessage={value && !valid ? "Use 6–20 letters or digits, starting with a letter." : undefined}
      className={`pl-10 ${statusText ? "pr-24" : ""}`}
      autoComplete="username"
      required
      minLength={6}
      maxLength={20}
      pattern="[A-Za-z][A-Za-z0-9]{5,19}"
      value={value}
      disabled={disabled}
      onChange={event => { setResult(null); onChange(event.target.value); }}
      aria-describedby={statusText ? `${id}-availability` : undefined}
    />
  );
}
