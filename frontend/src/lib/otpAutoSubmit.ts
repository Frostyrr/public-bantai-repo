import { isAuthenticatorCode } from "./verificationCode";

export interface AutoSubmitCheck {
  code: string;
  enabled: boolean;
  busy: boolean;
  lastAttemptedCode: string | null;
}

/**
 * Determines whether an OTP/MFA code should automatically trigger verification.
 * Prevents duplicate/concurrent requests and avoids auto-retrying a failed code.
 */
export function canAutoSubmitOtp({
  code,
  enabled,
  busy,
  lastAttemptedCode,
}: AutoSubmitCheck): boolean {
  if (!enabled || busy) return false;
  if (!isAuthenticatorCode(code)) return false;
  if (lastAttemptedCode === code) return false;
  return true;
}
