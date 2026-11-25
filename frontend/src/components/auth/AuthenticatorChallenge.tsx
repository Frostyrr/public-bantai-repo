import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mail, Smartphone, ArrowRight } from "lucide-react";
import API from "../../config/apiClient";
import queryClient from "../../config/queryClient";
import { formatErrorMessage } from "../../utils/formatError";
import { supabase } from "../../config/supabase";
import { logout } from "../../lib/api";
import { initialMfaMethod, requestEmailChallenge, type EmailChallengeState, type MfaMethod } from "../../lib/mfaChallenge";
import { useAutoSubmitOtp } from "../../hooks/useAutoSubmitOtp";
import AuthLayout from "./AuthLayout";
import AuthenticatorCodeInput from "./AuthenticatorCodeInput";
import { isAuthenticatorCode } from "../../lib/verificationCode";
import Button from "../ui/Button";
import Select from "../ui/Select";
import VerificationHeader from "./VerificationHeader";

type Availability = { sessionId: string; email: boolean; factors: { id: string; friendly_name?: string }[] };

export default function AuthenticatorChallenge({ onVerified }: { onVerified: () => void }) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [factorId, setFactorId] = useState("");
  const [method, setMethod] = useState<MfaMethod | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [emailChallenge, setEmailChallenge] = useState<EmailChallengeState | null>(null);
  const [now, setNow] = useState(Date.now);
  const working = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void Promise.all([
      API.get<{ enabled: boolean; sessionId: string }>("/auth/email-mfa", { signal: controller.signal }),
      supabase.auth.mfa.listFactors(),
    ]).then(([{ data: email }, { data, error }]) => {
      if (!active) return;
      if (error || !email.sessionId) throw new Error("Could not load verification methods.");
      const factors = (data?.totp ?? []).filter(factor => factor.status === "verified");
      setAvailability({ sessionId: email.sessionId, email: email.enabled, factors });
      setFactorId(factors[0]?.id ?? "");
      setMethod(initialMfaMethod(factors.length > 0, email.enabled));
    }).catch(() => {
      if (active) setError("Could not load verification methods. Please try again.");
    });
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function sendEmailCode(sessionId: string, resend = false) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setCode("");
    try {
      const result = await requestEmailChallenge(queryClient, sessionId,
        () => API.post("/auth/email-mfa/send", { method: "email" }), formatErrorMessage, resend);
      if (mounted.current) { setEmailChallenge(result); setNow(Date.now()); }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // Only the single-method email flow starts automatically. Both-method flow waits for a click.
  useEffect(() => {
    if (availability?.email && availability.factors.length === 0) {
      void sendEmailCode(availability.sessionId);
    }
  }, [availability]);

  const bothMethods = Boolean(availability?.email && availability.factors.length);
  const seconds = Math.max(0, Math.ceil(((emailChallenge?.resendAfter ?? 0) - now) / 1000));
  const expired = Boolean(emailChallenge?.sent && emailChallenge.expiresAt <= now);
  const canVerify = method === "email" ? Boolean(emailChallenge?.sent && !expired) : method === "totp" && Boolean(factorId);

  function chooseMethod(next: MfaMethod) {
    if (!availability || working.current) return;
    if (next === "email" ? !availability.email : !availability.factors.length) return;
    setMethod(next);
    setCode("");
    setError("");
    if (next === "email") void sendEmailCode(availability.sessionId);
  }

  async function submitCode(submittedCode: string) {
    if (working.current || !canVerify || !isAuthenticatorCode(submittedCode)) return;
    working.current = true;
    setBusy(true);
    setVerifying(true);
    setError("");
    try {
      if (method === "email") {
        await API.post("/auth/email-mfa/verify", { code: submittedCode, method: "email" });
      } else if (method === "totp") {
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: submittedCode });
        if (error) throw error;
      } else return;
      onVerified();
    } catch (err) {
      setError(method === "email" ? formatErrorMessage(err) :
        "Could not verify that code. Try a fresh code from your authenticator app.");
    } finally {
      working.current = false;
      if (mounted.current) {
        setBusy(false);
        setVerifying(false);
      }
    }
  }

  const { markAttempted } = useAutoSubmitOtp({
    code,
    enabled: Boolean(method) && canVerify,
    busy,
    onSubmit: submitCode,
  });

  function verify(event: FormEvent) {
    event.preventDefault();
    markAttempted(code);
    void submitCode(code);
  }

  return <AuthLayout>
    <VerificationHeader email={method === "email"} title={bothMethods && !method ? "Choose a verification method" : "Verify your identity"}>
      {!availability ? "Checking your verification methods..." : !method
        ? "Choose how you would like to verify this sign-in."
        : method === "email" ? "Enter the six-digit code sent to your enrolled inbox."
          : "Enter the current six-digit code from your authenticator app."}
    </VerificationHeader>
    {bothMethods && !method && <div className="mb-5 space-y-3">
      {([{ method: "totp", title: "Authenticator App", detail: "Use a code from your authenticator app.", Icon: Smartphone },
        { method: "email", title: "Email Verification", detail: "Send a code to your enrolled inbox.", Icon: Mail }] as const).map(({ method, title, detail, Icon }) =>
        <button key={method} type="button" disabled={busy} onClick={() => chooseMethod(method)} className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-subtle bg-elevated p-4 text-left transition-colors hover:border-strong hover:bg-selected-surface dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-zinc-400 disabled:opacity-50">
          <Icon className="size-5 shrink-0 text-secondary" aria-hidden="true" />
          <span className="flex-1"><span className="block text-sm font-medium text-primary">{title}</span><span className="mt-1 block text-xs text-secondary">{detail}</span></span>
          <ArrowRight className="size-4 text-muted" aria-hidden="true" />
        </button>)}
    </div>}
    <form onSubmit={verify} className="verification-form space-y-4">
      {method && <>
        {method === "email" && <Button type="button" variant="outline" disabled={busy || seconds > 0}
          onClick={() => availability && void sendEmailCode(availability.sessionId, true)}>
          {seconds > 0 ? `Resend in ${seconds}s` : emailChallenge?.sent ? "Resend email code" : "Send email code"}
        </Button>}
        {method === "totp" && availability && availability.factors.length > 1 && <Select label="Authenticator" value={factorId} disabled={busy}
          onChange={event => { setFactorId(event.target.value); setCode(""); }}
          options={availability.factors.map((factor, index) => ({ value: factor.id, label: factor.friendly_name || `Authenticator ${index + 1}` }))} />}
        <AuthenticatorCodeInput
          label={method === "email" ? "Email verification code" : "Authenticator code"}
          value={code}
          onChange={next => { setCode(next); if (error) setError(""); }}
          disabled={busy || !canVerify}
        />
        {verifying && (
          <p role="status" aria-live="polite" className="text-xs text-secondary text-center">
            Verifying code…
          </p>
        )}
        {method === "email" && expired && <p role="status" className="text-xs text-secondary">Your code has expired. Request a new email code.</p>}
        {method === "email" && emailChallenge?.error && <p role="alert" className="text-sm text-sem-error-fg">{emailChallenge.error}</p>}
        <Button type="submit" className="auth-primary" isLoading={verifying} disabled={busy || !canVerify || !isAuthenticatorCode(code)}>
          {verifying ? "Verifying..." : "Verify code"}
        </Button>
        {bothMethods && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setMethod(null); setCode(""); setError(""); }}>Use another verification method</Button>}
      </>}
      {error && <p role="alert" className="text-sm text-sem-error-fg">{error}</p>}
      {(!availability && error || availability && !availability.email && !availability.factors.length) && <>
        {availability && <p role="alert" className="text-sm text-sem-error-fg">No verification method is available.</p>}
        <Button type="button" variant="outline" onClick={() => { setAvailability(null); setMethod(null); setError(""); setAttempt(value => value + 1); }}>Try again</Button>
      </>}
      <Button type="button" variant="ghost" className="verification-cancel" disabled={busy} onClick={() => {
        void logout().then(() => window.location.assign("/login")).catch(() => setError("Could not sign out. Try again."));
      }}>Cancel verification</Button>
    </form>
  </AuthLayout>;
}
