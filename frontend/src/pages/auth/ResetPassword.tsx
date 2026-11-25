import { assessPassword } from "../../lib/passwordPolicy";
import PasswordStrength from "../../components/auth/PasswordStrength";
import { showFormErrors } from "../../lib/formValidation";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createRecoveryFlow } from "../../lib/recovery";
import { isRecoveryCode } from "../../lib/recoveryFlow";
import AuthLayout from "../../components/auth/AuthLayout";
import TurnstileWidget from "../../components/auth/TurnstileWidget";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import AuthenticatorCodeInput from "../../components/auth/AuthenticatorCodeInput";
import { useAutoSubmitOtp } from "../../hooks/useAutoSubmitOtp";
import { isAuthenticatorCode } from "../../lib/verificationCode";
import VerificationHeader from "../../components/auth/VerificationHeader";
import RecoveryQuestionFields from "../../components/auth/RecoveryQuestionFields";
import SecurityQuestionManager from "../../components/auth/SecurityQuestionManager";
import type {ManagedHistoryStatus} from "../../lib/securityQuestions";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const flow = useRef<ReturnType<typeof createRecoveryFlow> | null>(null);
  useEffect(() => {
    flow.current = createRecoveryFlow();
    return () => { flow.current?.dispose(); flow.current = null; };
  }, []);
  const [stage, setStage] = useState<"request" | "verify" | "choose_method" | "authenticator" | "questions" | "replace" | "reconcile" | "password" | "done">("request");
  const [hasAuthenticator, setHasAuthenticator] = useState(false);
  const [history,setHistory]=useState<ManagedHistoryStatus>();
  const [questions,setQuestions]=useState<number[]>([]);
  const [answers,setAnswers]=useState(["","",""]);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  async function proceedToPasswordOrReconcile(statusOverride?: ManagedHistoryStatus) {
    const h = statusOverride ?? (await flow.current!.peekMethods()).managedHistory;
    setHistory(h);
    setStage(h?.pending || h?.needsReconciliation ? "reconcile" : "password");
  }
  async function nextRecoveryStep(requiresAuth?: boolean) {
    const status=await flow.current!.peekMethods();
    setQuestions(status.questions);setAnswers(["","",""]);
    setHistory(status.managedHistory);
    const authAvailable = requiresAuth ?? hasAuthenticator;
    if (requiresAuth !== undefined) setHasAuthenticator(requiresAuth);
    if (authAvailable && status.enabled) {
      setStage("choose_method");
    } else if (authAvailable) {
      setStage("authenticator");
    } else if (status.enabled) {
      flow.current!.chooseRecoveryQuestions();
      setStage("questions");
    } else {
      setStage(status.managedHistory?.pending||status.managedHistory?.needsReconciliation?"reconcile":"password");
    }
  }
  useEffect(() => {
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  async function request() {
    if (!flow.current || busy || cooldown) return;
    if (!captchaToken) {
      setMessage("Please complete the security verification before requesting a code.");
      return;
    }
    setBusy(true); setMessage(""); setCooldown(60);
    try {
      await flow.current.request(email.trim(), captchaToken);
      setToken("");
      setStage("verify");
      setMessage("If an account exists for this email, a recovery code has been sent.");
    } catch { setMessage("Unable to request a code right now. Please wait and try again."); }
    finally {
      setBusy(false);
      setCaptchaToken(null);
      setTurnstileResetSignal(s => s + 1);
    }
  }
  const { markAttempted } = useAutoSubmitOtp({
    code: token,
    enabled: stage === "authenticator",
    busy,
    onSubmit: async (submittedToken) => {
      if (!flow.current || busy || stage !== "authenticator") return;
      setBusy(true); setMessage("");
      try {
        await flow.current.verifyAuthenticator(submittedToken);
        setToken(""); await proceedToPasswordOrReconcile();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to continue. Please try again.");
      } finally {
        setBusy(false);
      }
    },
  });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (showFormErrors(event.currentTarget)) return;
    if (stage === "request") { await request(); return; }
    if (stage === "authenticator") markAttempted(token);
    if (!flow.current || busy) return;
    setBusy(true); setMessage("");
    try {
      if (stage === "verify") {
        const { requiresAuthenticator } = await flow.current.verify(email.trim(), token);
        setToken("");
        await nextRecoveryStep(requiresAuthenticator);
      } else if (stage === "authenticator") {
        await flow.current.verifyAuthenticator(token);
        setToken(""); await proceedToPasswordOrReconcile();
      } else if (stage === "questions") {
        await flow.current.questionRequest("/verify","POST",{answers});
        setAnswers(["","",""]);setStage(history?.pending||history?.needsReconciliation?"reconcile":"password");
      } else if(stage === "reconcile"){
        await flow.current.questionRequest("/reconcile","POST");
        // A fresh status check also re-establishes any consumed question proof.
        await nextRecoveryStep();
      } else if (stage === "password") {
        const passwordError = assessPassword(password).error;
        if (passwordError) throw new Error(passwordError);
        if (password !== confirm) throw new Error("Passwords do not match.");
        await flow.current.update(password);
        setPassword(""); setConfirm(""); setStage("done");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to continue. Please try again."); setToken(""); }
    finally { setBusy(false); }
  }
  return (
    <AuthLayout returnTo="/login">
      {stage === "choose_method" || stage === "authenticator" || stage === "questions" || stage === "replace" ? <VerificationHeader title={stage==="choose_method"?"Choose recovery method":stage==="authenticator"?"Verify your identity":stage==="replace"?"Replace recovery questions":"Your recovery questions"} email={stage==="replace"}>
        {stage==="choose_method"?
        "Your email code is verified. Choose how you want to complete your identity check."
        :stage==="authenticator"?
        "Enter the current six-digit code from your authenticator app to continue resetting your password."
        :stage==="replace"?"Confirm a fresh email code to replace your forgotten answers.":"Answer all three questions to continue resetting your password."}
      </VerificationHeader> : <div className="flex flex-col text-left mb-7">
        <h1 className="mb-2 text-2xl tracking-[-0.02em] sm:text-[28px]">
          <span className="text-display-gradient">Reset password.</span>
        </h1>
        <p className="font-body font-normal text-zinc-400 text-xs sm:text-sm leading-relaxed">
          {stage === "request" && searchParams.get("from") === "legacy-link"
            ? "Request a new email code here to reset your password."
            : "Verify your identity with a recovery code to update your password."}
        </p>
      </div>}

      {stage === "replace" ? <SecurityQuestionManager
        request={(path,method,body)=>flow.current!.questionRequest("/manage"+path,method,body)}
        onCancel={()=>{setStage("questions");setMessage("");}}
        onComplete={()=>{setMessage("Recovery questions replaced. Answer your new questions to continue.");void nextRecoveryStep().catch(error=>setMessage(error.message));}}
      /> : stage === "done" ? (
        <div className="text-center py-4">
          <p role="status" className="text-sm text-zinc-200 mb-6">
            Password updated successfully. Sign in with your new password.
          </p>
          <Button to="/login" variant="primary" className="auth-primary">
            Sign in to Dashboard
          </Button>
        </div>
      ) : stage === "choose_method" ? (
        <div className="space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setToken("");
              setMessage("");
              setStage("authenticator");
            }}
            className="w-full rounded-xl border border-subtle bg-elevated p-4 text-left transition-colors hover:border-strong focus-visible:outline-2 focus-visible:outline-strong cursor-pointer"
          >
            <div className="text-sm font-medium text-primary">Authenticator App (TOTP)</div>
            <p className="mt-1 text-xs text-secondary">
              Verify with the 6-digit code from your authenticator app. Fastest if you have your device handy.
            </p>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              flow.current?.chooseRecoveryQuestions();
              setAnswers(["", "", ""]);
              setMessage("");
              setStage("questions");
            }}
            className="w-full rounded-xl border border-subtle bg-elevated p-4 text-left transition-colors hover:border-strong focus-visible:outline-2 focus-visible:outline-strong cursor-pointer"
          >
            <div className="text-sm font-medium text-primary">Email Code + Recovery Questions</div>
            <p className="mt-1 text-xs text-secondary">
              Answer your 3 security questions. Best if you don&apos;t have access to your authenticator app.
            </p>
          </button>
        </div>
      ) : (
        <form onSubmit={event => void submit(event)} className={`${stage === "authenticator" || stage === "verify" ? "verification-form " : ""}space-y-4`}>
          {stage==="reconcile"&&<p className="text-sm text-zinc-300">{history?.stale?"Your password history needs verification following activity outside Bantai. Continue with verified recovery. All known passwords remain protected. Earlier passwords used only outside Bantai cannot be checked; this gap remains recorded until three further password changes after recovery.":"An unfinished password change needs to be resolved. Continue to safely finish or cancel that operation before choosing a new password. This will not clear your password history."}</p>}
          {stage==="questions"&&<>
            <p className="text-xs text-zinc-400">Email verified · {questions.length} recovery questions · New password</p>
            <RecoveryQuestionFields questions={questions} answers={answers} onAnswers={setAnswers} disabled={busy}/>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" disabled={busy} onClick={()=>{setStage("replace");setAnswers(["","",""]);setMessage("");}}>Forgot your answers?</Button>
              {hasAuthenticator && (
                <Button variant="ghost" disabled={busy} onClick={()=>{setAnswers(["","",""]);setMessage("");setStage("choose_method");}}>Choose another method</Button>
              )}
            </div>
          </>}
          {stage === "request" && (
            <>
              <Input
                label="Email Address"
                type="email"
                placeholder="name@organization.org"
                required
                value={email}
                disabled={busy}
                onChange={event => setEmail(event.target.value)}
              />
              <TurnstileWidget
                action="password_reset"
                resetSignal={turnstileResetSignal}
                disabled={busy}
                onTokenChange={setCaptchaToken}
              />
            </>
          )}
          {stage === "verify" && (
            <>
              <p className="text-xs text-zinc-400">Enter the 6-digit code from the newest password reset email sent to {email}.</p>
              <AuthenticatorCodeInput
                label="Recovery code"
                value={token}
                onChange={next => { setToken(next); if (message) setMessage(""); }}
                disabled={busy}
              />
            </>
          )}
          {stage === "authenticator" && (
            <>
              <AuthenticatorCodeInput value={token} onChange={next => { setToken(next); if (message) setMessage(""); }} disabled={busy} />
              {questions.length === 3 && (
                <Button variant="ghost" disabled={busy} onClick={() => { setToken(""); setMessage(""); setStage("choose_method"); }}>
                  Choose another verification method
                </Button>
              )}
            </>
          )}
          {stage === "password" && (
            <>
              {history&&<p className="text-xs text-zinc-400">{history.bootstrap?"This account has no tracked password history yet. This first recovery starts tracking your new password; earlier passwords cannot be checked. Future managed changes reject your current and up to three previously tracked passwords.":"Choose a password different from your current and three previously tracked passwords."}</p>}
              {Boolean(history?.coverageGap)&&!history?.bootstrap&&<p className="text-xs text-zinc-400">External password changes left a recorded history gap. Known passwords are still checked; earlier external passwords cannot be reconstructed.</p>}
              {history?.paused&&<p role="status" className="text-sm text-zinc-300">Password changes are temporarily paused. Your verified recovery resolved any unfinished operation. You can return later to choose a new password.</p>}
              {questions.length===3&&<Button variant="ghost" disabled={busy} onClick={()=>{setStage("questions");setMessage("");}}>Back to recovery questions</Button>}
              <Input
                label="New Password"
                validationMessage={assessPassword(password).error ?? undefined}
                type="password"
                placeholder="••••••••••••"
                autoComplete="new-password"
                minLength={6}
                required
                value={password}
                disabled={busy}
                onChange={event => setPassword(event.target.value)}
              />
              <PasswordStrength password={password} />
              <Input
                label="Confirm Password"
                validationMessage={password !== confirm ? "Enter the same password again." : undefined}
                type="password"
                placeholder="••••••••••••"
                autoComplete="new-password"
                minLength={6}
                required
                value={confirm}
                disabled={busy}
                onChange={event => setConfirm(event.target.value)}
              />
            </>
          )}
          <Button
            type="submit"
            variant="primary"
            className="auth-primary mt-2"
            isLoading={busy}
            disabled={(stage === "password" && history?.paused) || (stage === "request" && (cooldown > 0 || !captchaToken))
              || (stage === "verify" && !isRecoveryCode(token))
              || (stage === "authenticator" && !isAuthenticatorCode(token))
              || (stage === "questions" && answers.some(answer=>answer.trim().length<2))}
          >
            {stage === "request" ? "Send recovery code" : stage === "password" ? "Update password" : stage==="reconcile"?"Resolve unfinished change":stage==="questions"?"Verify answers":"Verify code"}
          </Button>
        </form>
      )}

      {message && <p role="status" className="my-4 text-xs text-zinc-300 text-center">{message}</p>}

      {stage === "verify" && (
        <div className="mt-3 space-y-3">
          {cooldown === 0 && (
            <TurnstileWidget
              action="password_reset"
              resetSignal={turnstileResetSignal}
              disabled={busy}
              onTokenChange={setCaptchaToken}
            />
          )}
          <button
            type="button"
            disabled={busy || cooldown > 0 || !captchaToken}
            onClick={() => void request()}
            className="w-full text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cooldown ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-zinc-900 text-center">
        {stage!=="request"&&stage!=="done"&&<Button variant="ghost" className="text-zinc-400" disabled={busy} onClick={()=>{
          flow.current?.dispose();flow.current=createRecoveryFlow();setStage("request");setToken("");setAnswers(["","",""]);setPassword("");setConfirm("");setMessage("");
        }}>Start recovery again</Button>}
        <p className="mt-2 text-[11px] text-zinc-500">Refreshing or leaving this page clears recovery progress.</p>
      </div>
    </AuthLayout>
  );
}
