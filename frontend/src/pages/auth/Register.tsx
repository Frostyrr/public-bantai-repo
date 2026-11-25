import { assessPassword } from "../../lib/passwordPolicy";
import PasswordStrength from "../../components/auth/PasswordStrength";
import { showFormErrors } from "../../lib/formValidation";
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Check } from "lucide-react";
import AuthLayout from "../../components/auth/AuthLayout";
import AuthSwitchLink from "../../components/auth/AuthSwitchLink";
import { legalDocumentPath } from "../../lib/legalNavigation";
import TurnstileWidget from "../../components/auth/TurnstileWidget";
import Input from "../../components/ui/Input";
import UsernameAvailability from "../../components/auth/UsernameAvailability";
import Button from "../../components/ui/Button";
import { GoogleIcon } from "../../components/ui/SocialIcons";
import { register, loginWithGoogle } from "../../lib/api";
import { useMutation } from "@tanstack/react-query";
import { formatSignupError } from "../../lib/signupError";
import { formatErrorMessage } from "../../utils/formatError";
import { emptyIdentity,identityError } from "../../lib/identity";

export const Register: React.FC = () => {
  const navigate = useNavigate();
  const [identity,setIdentity]=useState(emptyIdentity);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [error, setError] = useState("");

  const {
    mutate: createAccount,
    isPending,
    isError,
    error: mutationError,
  } = useMutation({
    mutationFn: register,
    onSuccess: (_, variables) => {
      // Redirect to /verify-email prompt page passing registered email in location state
      navigate("/email/verify", {
        replace: true,
        state: { email: variables.email },
      });
    },
    onError: () => {
      setCaptchaToken(null);
      setTurnstileResetSignal((s) => s + 1);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;
    if (showFormErrors(e.currentTarget)) return;
    const personalError=identityError(identity);
    if(personalError){setError(personalError);return;}
    if (!email || !password) {
      setError("Please fill in all required fields");
      return;
    }
    const passwordError = assessPassword(password).error;
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (!agreedToTerms) {
      setError(
        "Please agree to the Terms of Service and Privacy Policy to proceed",
      );
      return;
    }
    if (!captchaToken) {
      setError(
        "Please complete the security verification before creating your account.",
      );
      return;
    }
    setError("");
    createAccount({ email, password, captchaToken,...identity });
  };

  const displayErrorMsg = isError ? formatSignupError(mutationError) : error;

  const allRequiredReady =
    Boolean(identity.firstName?.trim()) &&
    Boolean(identity.lastName?.trim()) &&
    Boolean(identity.username?.trim()) &&
    Boolean(email.trim()) &&
    Boolean(password) &&
    Boolean(confirmPassword) &&
    agreedToTerms &&
    Boolean(captchaToken);

  return (
    <AuthLayout view="register">
      {/* Card Header */}
      <div className="flex flex-col text-left mb-6">
        <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">
          <span className="text-primary">Start your journey.</span>
        </h1>
        <p className="font-body font-normal text-secondary text-xs sm:text-sm leading-relaxed">
          Create your account to bring transparency and financial accountability
          to your team.
        </p>
      </div>

      {/* Error Banner */}
      {displayErrorMsg && (
        <div role="alert" className="bg-sem-error-bg border border-sem-error-border rounded-2xl p-3.5 mb-5 text-sem-error-fg text-xs font-body font-normal flex items-start gap-3 shadow-lg backdrop-blur-md hardware-sharp">
          <AlertCircle className="w-4 h-4 text-sem-error-fg shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sem-error-fg">Registration Error</span>
            <span className="opacity-90 leading-relaxed">
              {displayErrorMsg}
            </span>
          </div>
        </div>
      )}

      {/* Google Sign In Option */}
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

      {/* Divider: OR REGISTER WITH EMAIL */}
      <div className="relative flex items-center justify-center my-6">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-subtle" />
        </div>
        <span className="relative z-10 bg-canvas dark:bg-[#050507] px-3 text-[10px] font-mono tracking-widest text-muted uppercase">
          OR REGISTER WITH EMAIL
        </span>
      </div>

      {/* Registration Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Row 1: First Name | Last Name */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Input
            label="First name"
            placeholder="Don"
            autoComplete="given-name"
            required
            maxLength={100}
            value={identity.firstName ?? ""}
            disabled={isPending}
            onChange={e => setIdentity({ ...identity, firstName: e.target.value })}
          />
          <Input
            label="Last name"
            placeholder="Juan"
            autoComplete="family-name"
            required
            maxLength={100}
            value={identity.lastName ?? ""}
            disabled={isPending}
            onChange={e => setIdentity({ ...identity, lastName: e.target.value })}
          />
        </div>

        {/* Row 2: Username (Full-Width) */}
        <UsernameAvailability
          value={identity.username ?? ""}
          disabled={isPending}
          onChange={username => setIdentity({ ...identity, username })}
        />

        {/* Row 3: Email Address (Full-Width) */}
        <Input
          label="Email Address"
          type="email"
          placeholder="don.juan@organization.org"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        {/* Row 4: Password | Confirm Password */}
        <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Input
              label="Password"
              name="password"
              validationMessage={assessPassword(password).error ?? undefined}
              type="password"
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <PasswordStrength password={password} variant="bar" />
          </div>

          <Input
            label="Confirm password"
            name="confirmPassword"
            visibilityLabel="confirm password"
            validationMessage={
              !confirmPassword
                ? "Re-enter your password."
                : confirmPassword !== password
                  ? "Passwords do not match."
                  : undefined
            }
            type="password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        <div className="mt-1 flex items-start gap-2.5 text-xs text-secondary">
          <span className="relative mt-0.5 flex size-4 shrink-0">
          <input
            id="accept-terms"
            aria-labelledby="accept-terms-label"
            type="checkbox"
            required
            disabled={isPending}
            checked={agreedToTerms}
            onChange={(event) => setAgreedToTerms(event.target.checked)}
            className="auth-agreement peer size-4 cursor-pointer rounded border border-strong bg-surface transition-colors checked:border-primary checked:bg-action hover:border-primary disabled:cursor-not-allowed"
          />
          <Check aria-hidden="true" className="pointer-events-none absolute inset-0 size-4 p-0.5 text-action-fg opacity-0 peer-checked:opacity-100" strokeWidth={3} />
          </span>
          <span id="accept-terms-label" className="leading-tight">
            <label htmlFor="accept-terms" className="cursor-pointer">
              I agree to the
            </label>{" "}
            <Link
              to={legalDocumentPath("/terms", "/register")}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:opacity-80 underline underline-offset-2 transition-colors"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              to={legalDocumentPath("/privacy", "/register")}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:opacity-80 underline underline-offset-2 transition-colors"
            >
              Privacy Policy
            </Link>
            .
          </span>
        </div>

        <TurnstileWidget
          action="register"
          resetSignal={turnstileResetSignal}
          disabled={isPending}
          onTokenChange={setCaptchaToken}
        />

        {/* Standard Proportion Primary Button */}
        <Button
          type="submit"
          variant="primary"
          isLoading={isPending}
          disabled={isPending || !allRequiredReady}
          iconRight={
            isPending ? undefined : (
              <ArrowRight className="w-4 h-4" />
            )
          }
          className="auth-primary mt-2"
        >
          {isPending ? "Creating Account..." : "Create Account"}
        </Button>
      </form>

      {/* Switch Account Link */}
      <p className="text-center text-xs sm:text-sm text-secondary font-body font-normal mt-5">
        Already have an account?{" "}
        <AuthSwitchLink to="/login" className="text-primary font-medium hover:underline">
          Log in instead.
        </AuthSwitchLink>
      </p>
    </AuthLayout>
  );
};

export default Register;
