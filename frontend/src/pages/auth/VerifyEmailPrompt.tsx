import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../config/supabase";
import { resendVerificationEmail } from "../../lib/api";
import AuthLayout from "../../components/auth/AuthLayout";
import TurnstileWidget from "../../components/auth/TurnstileWidget";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import AuthenticatorCodeInput from "../../components/auth/AuthenticatorCodeInput";
import VerificationHeader from "../../components/auth/VerificationHeader";
import { useAutoSubmitOtp } from "../../hooks/useAutoSubmitOtp";

export default function VerifyEmailPrompt() {
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cooldown, setCooldown] = useState(60);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  async function submitVerification(submittedToken: string) {
    if (busy || submittedToken.length !== 6 || !email.trim()) return;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: submittedToken, type: "email" });
      if (error || !data.session) setMessage("Invalid or expired code. Request a new code and try again.");
      else navigate("/dashboard", { replace: true });
    } catch { setMessage("Unable to verify the code. Please try again."); }
    finally { setBusy(false); }
  }
  const { markAttempted } = useAutoSubmitOtp({
    code: token,
    enabled: Boolean(email.trim()),
    busy,
    onSubmit: submitVerification,
  });
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    markAttempted(token);
    await submitVerification(token);
  }
  async function resend() {
    if (busy || cooldown) return;
    if (!captchaToken) {
      setMessage("Please complete the security verification before requesting a new code.");
      return;
    }
    setBusy(true); setCooldown(60);
    try {
      await resendVerificationEmail(email.trim(), captchaToken);
      setMessage("If your account needs confirmation, a new code has been sent.");
    } catch { setMessage("Unable to send a code right now. Please wait and try again."); }
    finally {
      setBusy(false);
      setCaptchaToken(null);
      setTurnstileResetSignal(s => s + 1);
    }
  }
  return (
    <AuthLayout returnTo="/login">
      <VerificationHeader email title="Verify your email">
        Enter the six-digit code sent to your email to confirm your account.
      </VerificationHeader>

      <form onSubmit={event => void verify(event)} className="verification-form space-y-4">
        <Input
          label="Email Address"
          type="email"
          placeholder="name@organization.org"
          required
          value={email}
          disabled={busy}
          onChange={event => { setEmail(event.target.value); setToken(""); }}
        />
        <AuthenticatorCodeInput
          label="Email verification code"
          value={token}
          disabled={busy}
          onChange={next => { setToken(next); if (message) setMessage(""); }}
        />
        <Button
          type="submit"
          variant="primary"
          className="auth-primary mt-2"
          isLoading={busy}
          disabled={busy || token.length !== 6}
        >
          {busy ? "Verifying..." : "Verify Account"}
        </Button>
      </form>

      {message && <p role="status" className="my-4 text-xs text-zinc-300 text-center">{message}</p>}

      <div className="mt-6 pt-4 border-t border-zinc-900 text-center space-y-3">
        {cooldown === 0 && (
          <TurnstileWidget
            action="resend_verification"
            resetSignal={turnstileResetSignal}
            disabled={busy}
            onTokenChange={setCaptchaToken}
          />
        )}
        <button
          type="button"
          disabled={busy || cooldown > 0 || !email.trim() || !captchaToken}
          onClick={() => void resend()}
          className="w-full text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer text-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cooldown ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </AuthLayout>
  );
}
