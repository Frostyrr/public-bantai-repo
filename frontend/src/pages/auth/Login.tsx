import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight } from "lucide-react";
import AuthLayout from "../../components/auth/AuthLayout";
import AuthSwitchLink from "../../components/auth/AuthSwitchLink";
import { legalDocumentPath } from "../../lib/legalNavigation";
import TurnstileWidget from "../../components/auth/TurnstileWidget";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import { GoogleIcon } from "../../components/ui/SocialIcons";
import { login, loginWithGoogle } from "../../lib/api";
import { useMutation } from "@tanstack/react-query";
import { extractApiErrorDetails } from "../../config/sessionRecovery";
import { formatErrorMessage } from "../../utils/formatError";
import queryClient from "../../config/queryClient";
import { AUTH } from "../../hooks/useAuth";
import { getLoginRestriction } from "../../config/loginRestriction";

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const restriction = getLoginRestriction(state?.restriction);
  const sessionError = typeof state?.sessionError === "string" ? state.sessionError : "";
  const destination =
    state?.redirectUrl === "/app/settings?tab=security"
      ? state.redirectUrl
      : "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [error, setError] = useState("");
  const [lockedUntil, setLockedUntil] = useState(() => restriction?.retryAfterSeconds ? Date.now() + restriction.retryAfterSeconds * 1000 : 0);
  const [lockSeconds, setLockSeconds] = useState(() => restriction?.retryAfterSeconds ?? 0);

  useEffect(() => {
    if (!lockedUntil) return;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((lockedUntil - Date.now()) / 1000),
      );
      setLockSeconds(remaining);
      if (!remaining) setLockedUntil(0);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const {
    mutate: signIn,
    isPending,
    isError,
    error: mutationError,
  } = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [AUTH] });
      navigate(destination, { replace: true });
    },
    onError: (err) => {
      const { status, retryAfterSeconds } = extractApiErrorDetails(err);
      if ((status === 429 || status === 403) && retryAfterSeconds) {
        setLockSeconds(retryAfterSeconds);
        setLockedUntil(Date.now() + retryAfterSeconds * 1000);
      }
      setCaptchaToken(null);
      setTurnstileResetSignal((s) => s + 1);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending || lockSeconds > 0) return;
    if (!email || !password) {
      setError("Please fill in all required fields");
      return;
    }
    if (!captchaToken) {
      setError("Please complete the security verification before signing in.");
      return;
    }
    setError("");
    signIn({ identifier: email, password, captchaToken });
  };

  const rawError = isError ? mutationError : error || sessionError;
  const activeRestriction = (isError ? getLoginRestriction(mutationError, lockSeconds) : null) ?? (!error && !isError ? getLoginRestriction(state?.restriction, lockSeconds) : null);
  const displayErrorMsg = activeRestriction?.message ?? formatErrorMessage(rawError);

  return (
    <AuthLayout view="login">
      {/* Card Header */}
      <div className="flex flex-col text-left mb-6">
        <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">
          <span className="text-primary">Welcome back.</span>
        </h1>
        <p className="font-body font-normal text-secondary text-xs sm:text-sm leading-relaxed">
          Sign in to manage your organization with complete financial clarity.
        </p>
      </div>

      {/* Error Banner */}
      {displayErrorMsg && (
        <div role="alert" className="bg-sem-error-bg border border-sem-error-border rounded-2xl p-3.5 mb-5 text-sem-error-fg text-xs font-body font-normal flex items-start gap-3 shadow-lg backdrop-blur-md hardware-sharp">
          <AlertCircle className="w-4 h-4 text-sem-error-fg shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sem-error-fg">
              {activeRestriction?.title ?? "Authentication Error"}
            </span>
            <span className="opacity-90 leading-relaxed">
              {displayErrorMsg}
            </span>
          </div>
        </div>
      )}

      {/* Google Sign In Quick Option */}
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          void loginWithGoogle().catch((reason: unknown) =>
            setError(formatErrorMessage(reason)),
          )
        }
        icon={<GoogleIcon className="w-4 h-4 shrink-0" />}
        className="auth-google"
      >
        Continue with Google
      </Button>

      {/* Divider: OR CONTINUE WITH EMAIL */}
      <div className="relative flex items-center justify-center my-6">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-subtle" />
        </div>
        <span className="relative z-10 bg-canvas dark:bg-[#050507] px-3 text-[10px] font-mono tracking-widest text-muted uppercase">
          OR CONTINUE WITH EMAIL
        </span>
      </div>

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Email Address Field */}
        <Input
          label="Username or email"
          type="text"
          placeholder="name@organization.org"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />

        {/* Password Field */}
        <div className="flex flex-col gap-1.5">
          <Input
            label="Password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <div className="flex justify-end mt-0.5">
            <Link
              to="/password/forgot"
              className="font-body font-normal text-xs text-secondary hover:text-primary transition-colors"
            >
              Forgot Password?
            </Link>
          </div>
        </div>

        <TurnstileWidget
          action="login"
          resetSignal={turnstileResetSignal}
          disabled={isPending}
          onTokenChange={setCaptchaToken}
        />

        {/* High Contrast Primary Button */}
        <Button
          type="submit"
          variant="primary"
          isLoading={isPending}
          disabled={isPending || !captchaToken || lockSeconds > 0}
          iconRight={
            isPending ? undefined : (
              <ArrowRight className="w-4 h-4" />
            )
          }
          className="auth-primary mt-2"
        >
          {lockSeconds > 0
            ? `Try again in ${lockSeconds}s`
            : isPending
              ? "Signing In..."
              : "Sign In"}
        </Button>
      </form>

      {/* Switch Account Link */}
      <p className="text-center text-xs sm:text-sm text-secondary font-body font-normal mt-5">
        Don't have an account?{" "}
        {lockSeconds > 0 ? (
          <span aria-disabled="true">Create an account.</span>
        ) : (
          <AuthSwitchLink
            to="/register"
            className="text-primary font-medium hover:underline"
          >
            Create an account.
          </AuthSwitchLink>
        )}
      </p>
      <nav aria-label="Legal" className="mt-6 flex justify-center gap-4 text-[11px] text-muted">
        <Link to={legalDocumentPath("/terms", "/login")} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-primary">Terms of Service</Link>
        <Link to={legalDocumentPath("/privacy", "/login")} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-primary">Privacy Policy</Link>
      </nav>
    </AuthLayout>
  );
};

export default Login;
