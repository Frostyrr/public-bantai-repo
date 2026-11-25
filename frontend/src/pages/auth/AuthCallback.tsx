import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../config/supabase";
import { formatErrorMessage } from "../../utils/formatError";
import AuthLayout from "../../components/auth/AuthLayout";
import WorkspaceBootScreen from "../../components/layout/WorkspaceBootScreen";
import Button from "../../components/ui/Button";
import { AlertCircle } from "lucide-react";
import { extractApiErrorDetails, SESSION_FETCH_TIMEOUT_MS, withSessionDeadline } from "../../config/sessionRecovery";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const emailChange = searchParams.get("account") === "email-change";
  const [error, setError] = useState("");
  const [awaitingOtherInbox, setAwaitingOtherInbox] = useState(false);

  useEffect(() => {
    let active = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const callbackError = searchParams.get("error_code") ?? fragment.get("error_code");
    const partialConfirmation = searchParams.has("message") || fragment.has("message");
    // getSession waits for the SDK's automatic PKCE callback initialization.
    void withSessionDeadline(() => supabase.auth.getSession(), SESSION_FETCH_TIMEOUT_MS,
      "Checking your sign-in took too long. Please try signing in again.",
    ).then(({ data, error: authError }) => {
      if (!active) return;
      if (emailChange && callbackError) {
        window.history.replaceState({}, "", "/auth/callback");
        setError("This email confirmation link could not be completed. Return to Account Settings to check your email address or request a new link.");
      } else if (emailChange && partialConfirmation) {
        window.history.replaceState({}, "", "/auth/callback");
        setAwaitingOtherInbox(true);
      } else if (emailChange && !authError) {
        window.history.replaceState({}, "", "/auth/callback");
        navigate("/app/settings?tab=security", { replace: true });
      } else if (authError || !data.session) {
        setError(authError ? formatErrorMessage(authError) : "This link is invalid or expired. Request a new link and open it in the same browser.");
      } else {
        window.history.replaceState({}, "", "/auth/callback");
        navigate("/dashboard", { replace: true });
      }
    }).catch((reason: unknown) => {
      if (!active) return;
      if (extractApiErrorDetails(reason).isTimeout) {
        navigate("/login", { replace: true, state: { sessionError: formatErrorMessage(reason) } });
      } else setError(formatErrorMessage(reason));
    });
    return () => { active = false; };
  }, [emailChange, navigate, searchParams]);

  if (awaitingOtherInbox) {
    return <AuthLayout>
      <div className="space-y-3">
        <h1 className="text-2xl text-display-gradient">Check your other inbox</h1>
        <p className="text-sm text-zinc-400">Open the second confirmation link in this browser to finish changing your email address.</p>
        <Button to="/app/settings?tab=security" variant="outline">Back to security settings</Button>
      </div>
    </AuthLayout>;
  }

  if (!error) {
    return (
      <WorkspaceBootScreen
        mode="callback"
        ariaLabel="Completing sign-in"
      />
    );
  }

  return (
    <AuthLayout returnTo="/login">
      <div className="space-y-3">
        <AlertCircle className="size-6 text-rose-400" aria-hidden="true" />
        <h1 className="text-2xl tracking-[-0.02em] sm:text-[28px]">
          <span className="text-display-gradient">Sign-in could not be completed</span>
        </h1>
        <p className="text-sm leading-relaxed text-zinc-400" role="alert">{error}</p>
      </div>
    </AuthLayout>
  );
}
