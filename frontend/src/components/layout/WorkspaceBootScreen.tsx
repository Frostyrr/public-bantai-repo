import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { RotateCw } from "lucide-react";
import logoTransparentWhite from "../../assets/Bantai logo transparent bg.png";

export interface WorkspaceBootScreenProps {
  mode?: "session" | "callback";
  ariaLabel?: string;
  onRetry?: () => void;
  fallbackLoginPath?: string;
}

const STAGE_MESSAGES: Record<"session" | "callback", readonly string[]> = {
  session: [
    "Checking your session…",
    "Preparing your workspace…",
    "Almost ready…",
  ],
  callback: [
    "Completing sign-in…",
    "Verifying your session…",
    "Preparing your workspace…",
  ],
};

export default function WorkspaceBootScreen({
  mode = "session",
  ariaLabel = "Loading your workspace",
  onRetry,
  fallbackLoginPath = "/login",
}: WorkspaceBootScreenProps) {
  const [visible, setVisible] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [isSlow, setIsSlow] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const stages = STAGE_MESSAGES[mode];

  useEffect(() => {
    const revealTimer = window.setTimeout(() => setVisible(true), 130);
    const stage1Timer = window.setTimeout(() => setStageIndex(1), 900);
    const stage2Timer = window.setTimeout(() => setStageIndex(2), 2_400);
    const slowTimer = window.setTimeout(() => setIsSlow(true), 8_000);
    const deadlineTimer = window.setTimeout(() => setTimedOut(true), 30_000);

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(stage1Timer);
      window.clearTimeout(stage2Timer);
      window.clearTimeout(slowTimer);
      window.clearTimeout(deadlineTimer);
    };
  }, []);

  if (timedOut) return <Navigate to={fallbackLoginPath} replace state={{
    sessionError: "We couldn’t finish checking your session. Please sign in again.",
  }} />;

  return (
    <main
      className="dark min-h-screen bg-[#050507] text-white flex flex-col items-center justify-center relative overflow-hidden px-6"
      aria-busy="true"
      aria-label={ariaLabel}
    >
      {/* Top indeterminate progress bar */}
      <div className="fixed top-0 left-0 right-0 h-[2.5px] bg-white/10 overflow-hidden z-50">
        <div className="animate-loading-bar bg-emerald-400/90" />
      </div>

      {/* Subtle workspace shell silhouette for spatial continuity */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 flex flex-col transition-opacity duration-500 ${
          visible ? "opacity-[0.045]" : "opacity-0"
        }`}
      >
        <div className="h-14 border-b border-white/20 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-7 rounded-lg bg-white/30" />
            <div className="h-4 w-20 rounded bg-white/25" />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-28 rounded-full bg-white/20 hidden sm:block" />
            <div className="size-8 rounded-full bg-white/25" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 pt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="h-32 rounded-2xl border border-white/25 bg-white/10" />
          <div className="h-32 rounded-2xl border border-white/25 bg-white/10 hidden sm:block" />
          <div className="h-32 rounded-2xl border border-white/25 bg-white/10 hidden sm:block" />
        </div>
      </div>

      {/* Central focal badge */}
      <div
        className={`relative z-10 flex flex-col items-center text-center transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Emerald ambient glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 h-32 w-32 rounded-full bg-emerald-500/15 blur-3xl"
        />

        <div className="relative mb-5">
          <div
            aria-hidden="true"
            className="absolute -inset-1 rounded-2xl bg-gradient-to-b from-emerald-400/20 via-white/5 to-transparent blur-xs animate-pulse motion-reduce:animate-none"
          />
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/90 shadow-2xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
            />
            <img
              src={logoTransparentWhite}
              alt="Bantai"
              className="size-8 object-contain opacity-95"
            />
          </div>
        </div>

        <p
          role="status"
          aria-live="polite"
          className="text-sm font-medium tracking-[-0.01em] text-zinc-200"
        >
          {stages[stageIndex]}
        </p>

        {/* Subtle 3-dot activity indicator */}
        <div
          aria-hidden="true"
          className="mt-3 flex items-center gap-1.5"
        >
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="size-1.5 rounded-full bg-emerald-400/70 animate-pulse motion-reduce:animate-none"
              style={{ animationDelay: `${dot * 180}ms` }}
            />
          ))}
        </div>

        {/* Slow-connection fallback */}
        {isSlow && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-400">
            <span>Taking longer than expected.</span>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-zinc-200 hover:border-zinc-700 hover:text-white transition-colors cursor-pointer"
              >
                <RotateCw className="size-3" aria-hidden="true" />
                Retry
              </button>
            ) : (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-zinc-200 hover:border-zinc-700 hover:text-white transition-colors cursor-pointer"
              >
                <RotateCw className="size-3" aria-hidden="true" />
                Reload
              </button>
            )}
            <Link
              to={fallbackLoginPath}
              className="text-zinc-400 underline underline-offset-4 hover:text-zinc-200 transition-colors"
            >
              Return to sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
