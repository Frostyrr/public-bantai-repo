import { useEffect, useState, type FormEvent } from "react";
import API from "../../config/apiClient";
import { supabase } from "../../config/supabase";
import { formatErrorMessage } from "../../utils/formatError";
import Button from "../ui/Button";
import AuthenticatorCodeInput from "./AuthenticatorCodeInput";
import { useAutoSubmitOtp } from "../../hooks/useAutoSubmitOtp";
import { isAuthenticatorCode } from "../../lib/verificationCode";

type Factor = { id: string; friendly_name?: string };
type Setup = { id: string; qr: string; secret: string };

export default function AuthenticatorSettings() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [remove, setRemove] = useState<Factor | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadFactors() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    setFactors(data.totp);
    return data;
  }

  useEffect(() => {
    let active = true;
    void supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active) return;
      if (error) setError(formatErrorMessage(error));
      else setFactors(data.totp);
    }).catch(() => { if (active) setError("Couldn’t load two-factor settings."); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try { await action(); }
    catch (error) { setError(formatErrorMessage(error)); }
    finally { setBusy(false); }
  }

  function start() {
    return run(async () => {
      const data = await loadFactors();
      if (data.totp.length) return;
      const { data: enrollment, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Bantai" });
      if (error) throw error;
      setSetup({ id: enrollment.id, qr: enrollment.totp.qr_code, secret: enrollment.totp.secret });
    });
  }

  function cancel() {
    if (!setup) { setRemove(null); setCode(""); setError(""); return; }
    void run(async () => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: setup.id });
      if (error && error.code !== "mfa_factor_not_found") throw error;
      setSetup(null);
      setCode("");
    });
  }

  function submitCode(submittedCode: string) {
    const factor = setup ?? remove;
    if (!factor || !isAuthenticatorCode(submittedCode)) return;
    void run(async () => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: submittedCode });
      if (error) throw error;
      if (remove) {
        const result = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (result.error) throw result.error;
        setFactors(current => current?.filter(item => item.id !== factor.id) ?? []);
        setRemove(null);
        setCode("");
        setMessage("Authenticator removed.");
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.error) setError("The authenticator was removed. Sign in again to refresh your session.");
      } else {
        await API.post("/user/email-mfa/trust-authenticator", { factorId: factor.id });
        setFactors([{ id: factor.id }]);
        setSetup(null);
        setCode("");
        setMessage("Authenticator app enabled.");
      }
    });
  }

  const { markAttempted } = useAutoSubmitOtp({
    code,
    enabled: Boolean(setup ?? remove),
    busy,
    onSubmit: submitCode,
  });

  function verify(event: FormEvent) {
    event.preventDefault();
    markAttempted(code);
    submitCode(code);
  }

  return <section className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-4">
    <div>
      <h2 className="text-primary section-title">Authenticator app</h2>
      <p className="text-xs text-secondary mt-0.5">Add a six-digit authenticator code to future sign-ins. Keep access to your authenticator to avoid getting locked out.</p>
    </div>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {message && <p role="status" className="text-sm text-secondary">{message}</p>}
    {setup && <div className="space-y-2">
      <p className="text-sm text-secondary">Scan this QR code with your authenticator app, then enter the code it generates.</p>
      <img src={setup.qr} alt="Authenticator setup QR code" width={160} height={160} className="rounded-lg bg-white p-2" />
      <details className="text-sm text-secondary">
        <summary className="cursor-pointer">Enter a setup key instead</summary>
        <code className="block break-all select-all py-2">{setup.secret}</code>
      </details>
    </div>}
    {setup || remove ? <form onSubmit={verify} className="space-y-3 max-w-md">
      {remove && <p className="text-sm text-secondary">Enter a current code for this authenticator to remove it.</p>}
      <AuthenticatorCodeInput value={code} onChange={next => { setCode(next); if (error) setError(""); }} disabled={busy} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" isLoading={busy} disabled={busy || !isAuthenticatorCode(code)}>{busy ? "Verifying..." : remove ? "Remove authenticator" : "Enable authenticator"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={cancel}>Cancel</Button>
      </div>
    </form> : factors === null ? (
      error
        ? <Button type="button" size="sm" variant="outline" isLoading={busy} onClick={() => void run(async () => { await loadFactors(); })}>Try again</Button>
        : <p role="status" className="text-sm text-secondary">Checking authenticator settings…</p>
    ) : factors.length ? (
      factors.map((factor, index) => <div key={factor.id} className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-secondary">{factor.friendly_name || `Authenticator ${index + 1}`} enabled</p>
        <Button type="button" variant="outline" size="sm" onClick={() => { setRemove(factor); setMessage(""); setError(""); }}>Remove</Button>
      </div>)
    ) : <Button type="button" variant="outline" size="sm" isLoading={busy} onClick={start}>Set up authenticator</Button>}
  </section>;
}
