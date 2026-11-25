import { useEffect, useRef } from "react";
import { canAutoSubmitOtp } from "../lib/otpAutoSubmit";

interface UseAutoSubmitOtpOptions {
  code: string;
  enabled: boolean;
  busy: boolean;
  onSubmit: (code: string) => void | Promise<void>;
}

/**
 * Automatically submits a 6-digit OTP/MFA code once when completed or pasted,
 * while preventing concurrent requests and auto-retries of the same failed code.
 */
export function useAutoSubmitOtp({
  code,
  enabled,
  busy,
  onSubmit,
}: UseAutoSubmitOtpOptions) {
  const lastAttemptedRef = useRef<string | null>(null);
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    if (lastAttemptedRef.current !== null && code !== lastAttemptedRef.current) {
      lastAttemptedRef.current = null;
    }
  }, [code]);

  useEffect(() => {
    if (!enabled) {
      lastAttemptedRef.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    if (
      !canAutoSubmitOtp({
        code,
        enabled,
        busy,
        lastAttemptedCode: lastAttemptedRef.current,
      })
    ) {
      return;
    }
    lastAttemptedRef.current = code;
    void onSubmitRef.current(code);
  }, [code, enabled, busy]);

  return {
    markAttempted: (attemptedCode: string) => {
      lastAttemptedRef.current = attemptedCode;
    },
    resetAttempted: () => {
      lastAttemptedRef.current = null;
    },
  };
}
