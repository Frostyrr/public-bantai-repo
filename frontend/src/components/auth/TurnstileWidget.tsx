import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "compact" | "flexible";
  appearance?: "always" | "execute" | "interaction-only";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (errorCode?: string) => void;
  "timeout-callback"?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoadPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile can only load in a browser."));
  }
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`
    );

    const onReady = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        scriptLoadPromise = null;
        reject(new Error("Cloudflare Turnstile API failed to initialize."));
      }
    };

    const onError = () => {
      scriptLoadPromise = null;
      const failedScript = document.querySelector<HTMLScriptElement>(
        `script[src="${TURNSTILE_SCRIPT_SRC}"]`
      );
      failedScript?.remove();
      reject(new Error("Unable to load security verification widget."));
    };

    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", onError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", onError, { once: true });
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

function detectTheme(preferred: "auto" | "light" | "dark"): "light" | "dark" {
  if (preferred === "light" || preferred === "dark") return preferred;
  if (typeof document === "undefined") return "dark";
  if (document.documentElement.classList.contains("light")) return "light";
  if (document.documentElement.classList.contains("dark")) return "dark";
  return "dark";
}

export interface TurnstileWidgetHandle {
  reset: () => void;
}

export interface TurnstileWidgetProps {
  action?: string;
  theme?: "auto" | "light" | "dark";
  resetSignal?: number;
  disabled?: boolean;
  onTokenChange: (token: string | null) => void;
  onErrorChange?: (error: string | null) => void;
  className?: string;
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget(
    {
      action,
      theme = "auto",
      resetSignal = 0,
      disabled = false,
      onTokenChange,
      onErrorChange,
      className = "",
    },
    ref
  ) {
    const { resolvedTheme } = useTheme();
    const effectiveTheme = theme === "auto" ? resolvedTheme : theme;
    const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const onTokenChangeRef = useRef(onTokenChange);
    const onErrorChangeRef = useRef(onErrorChange);

    onTokenChangeRef.current = onTokenChange;
    onErrorChangeRef.current = onErrorChange;

    const [status, setStatus] = useState<"loading" | "ready" | "verified" | "error">(
      siteKey ? "loading" : "error"
    );
    const [errorMessage, setErrorMessage] = useState<string | null>(
      siteKey
        ? null
        : import.meta.env.DEV
        ? "Turnstile is not configured: set TURNSTILE_SITE_KEY in your environment."
        : "Security verification is currently unavailable."
    );

    const resetWidget = () => {
      onTokenChangeRef.current(null);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch {
          // Ignore reset errors if widget was already removed
        }
      }
    };

    useImperativeHandle(ref, () => ({
      reset: resetWidget,
    }));

    useEffect(() => {
      if (!siteKey) {
        const missingMessage = import.meta.env.DEV
          ? "Turnstile is not configured: set TURNSTILE_SITE_KEY in your environment."
          : "Security verification is currently unavailable.";
        onTokenChangeRef.current(null);
        onErrorChangeRef.current?.(missingMessage);
        return;
      }

      let cancelled = false;
      setStatus("loading");
      setErrorMessage(null);
      onErrorChangeRef.current?.(null);

      loadTurnstileScript()
        .then(turnstile => {
          if (cancelled || !containerRef.current) return;

          if (widgetIdRef.current) {
            try {
              turnstile.remove(widgetIdRef.current);
            } catch {
              // Ignore cleanup errors
            }
            widgetIdRef.current = null;
          }

          widgetIdRef.current = turnstile.render(containerRef.current, {
            sitekey: siteKey,
            action,
            theme: detectTheme(effectiveTheme),
            size: "flexible",
            appearance: "always",
            callback: (token: string) => {
              if (cancelled) return;
              setStatus("verified");
              setErrorMessage(null);
              onErrorChangeRef.current?.(null);
              onTokenChangeRef.current(token);
            },
            "expired-callback": () => {
              if (cancelled) return;
              onTokenChangeRef.current(null);
              setStatus("ready");
              const msg = "Security check expired. Please verify again.";
              setErrorMessage(msg);
              onErrorChangeRef.current?.(msg);
              if (widgetIdRef.current && window.turnstile) {
                try {
                  window.turnstile.reset(widgetIdRef.current);
                } catch {
                  // Ignore
                }
              }
            },
            "timeout-callback": () => {
              if (cancelled) return;
              onTokenChangeRef.current(null);
              setStatus("ready");
              const msg = "Security check timed out. Please try again.";
              setErrorMessage(msg);
              onErrorChangeRef.current?.(msg);
            },
            "error-callback": () => {
              if (cancelled) return;
              onTokenChangeRef.current(null);
              const msg = "Security verification failed to load. Please retry.";
              setStatus("error");
              setErrorMessage(msg);
              onErrorChangeRef.current?.(msg);
            },
          });

          setStatus("ready");
        })
        .catch(() => {
          if (cancelled) return;
          onTokenChangeRef.current(null);
          const msg = "Unable to load security verification. Check your connection and retry.";
          setStatus("error");
          setErrorMessage(msg);
          onErrorChangeRef.current?.(msg);
        });

      return () => {
        cancelled = true;
        onTokenChangeRef.current(null);
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // Ignore cleanup errors
          }
          widgetIdRef.current = null;
        }
      };
    }, [siteKey, action, effectiveTheme]);

    useEffect(() => {
      if (resetSignal > 0) {
        resetWidget();
      }
    }, [resetSignal]);

    return (
      <div
        className={`w-full ${disabled ? "pointer-events-none opacity-60" : ""} ${className}`}
        aria-busy={status === "loading"}
      >
        <div className="relative min-h-[65px] w-full">
          {status === "loading" && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-zinc-900/70 px-4"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400" aria-hidden="true" />
              <span className="text-xs text-zinc-400">Checking security…</span>
            </div>
          )}
          <div ref={containerRef} className="w-full" />
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200"
          >
            <span>{errorMessage}</span>
            {siteKey && (
              <button
                type="button"
                onClick={resetWidget}
                className="inline-flex shrink-0 items-center gap-1 font-medium text-rose-100 underline hover:text-white cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);

export default TurnstileWidget;
