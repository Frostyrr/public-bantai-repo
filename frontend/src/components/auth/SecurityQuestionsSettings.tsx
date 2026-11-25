import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldQuestion } from "lucide-react";
import API from "../../config/apiClient";
import { supabase } from "../../config/supabase";
import type {
  QuestionRequest,
  QuestionStatus,
} from "../../lib/securityQuestions";
import Button from "../ui/Button";
import SecurityQuestionManager from "./SecurityQuestionManager";
import AuthenticatorCodeInput from "./AuthenticatorCodeInput";
import { useAutoSubmitOtp } from "../../hooks/useAutoSubmitOtp";
import { isAuthenticatorCode } from "../../lib/verificationCode";
import { formatErrorMessage } from "../../utils/formatError";

const request: QuestionRequest = async <T,>(
  path: string,
  method = "GET",
  body?: unknown,
) =>
  (
    await API.request<T>({
      url: "/user/security-questions" + path,
      method,
      data: body,
    })
  ).data;
export default function SecurityQuestionsSettings({
  userId,
}: {
  userId: string;
}) {
  const status = useQuery({
    queryKey: ["security-questions", userId],
    queryFn: () => request<QuestionStatus>(""),
  });
  const [mode, setMode] = useState<"edit" | "disable" | null>(null);
  const [method, setMethod] = useState<"totp" | "email" | null>(null);
  const [preverified, setPreverified] = useState(false);
  const [factor, setFactor] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  async function begin(next: "edit" | "disable") {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const email = await API.get<{enabled:boolean}>("/auth/email-mfa");
      const factorId = data.totp.find(f => f.status === "verified")?.id ?? "";
      setFactor(factorId);
      setPreverified(false);
      setMethod(factorId ? (email.data.enabled ? null : "totp") : "email");
      setMode(next);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function verifyAuthenticator(submittedCode: string) {
    if (working.current || !isAuthenticatorCode(submittedCode)) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor, code: submittedCode });
      if (error) throw error;
      await request("/confirm-authenticator", "POST");
      if (mode === "disable") {
        await request("", "DELETE");
        setMode(null);
        setMessage("Recovery questions disabled.");
        void status.refetch();
      } else setPreverified(true);
      setCode("");
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const { markAttempted } = useAutoSubmitOtp({
    code,
    enabled: Boolean(mode && method === "totp" && !preverified),
    busy,
    onSubmit: verifyAuthenticator,
  });
  return (
    <section className="space-y-4 rounded-2xl border border-subtle bg-surface p-6 shadow-xs dark:shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <ShieldQuestion size={18} className="text-secondary" />
          <h2 className="section-title text-primary">Recovery questions</h2>
        </div>
        <span className="rounded-full border border-subtle px-2.5 py-1 text-[11px] text-secondary">
          {status.isPending
            ? "Checking…"
            : status.isError
              ? "Unavailable"
              : status.data?.enabled
                ? "Enabled"
                : "Off"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-secondary">Email-registered accounts can add three recovery questions. Confirm one verification method to change your questions. Password recovery retains its existing verification requirements.</p>
      {error && (
        <p role="alert" className="text-sm text-sem-error-fg">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-secondary">
          {message}
        </p>
      )}
      {status.isError ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void status.refetch()}
        >
          Try again
        </Button>
      ) : status.isPending ? <p className="text-xs text-secondary">Checking eligibility…</p> : status.data?.eligible !== true ? (
        <p className="text-xs text-secondary">Recovery questions are available only to accounts registered with email.</p>
      ) : mode && !method ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setMethod("totp")}>Authenticator App</Button>
          <Button variant="outline" onClick={() => setMethod("email")}>Email Verification</Button>
          <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
        </div>
      ) : mode && method === "totp" && !preverified ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            markAttempted(code);
            void verifyAuthenticator(code);
          }}
        >
          <p className="text-sm text-secondary">
            Confirm your authenticator code before changing recovery questions.
          </p>
          <AuthenticatorCodeInput
            value={code}
            onChange={next => { setCode(next); if (error) setError(""); }}
            disabled={busy}
          />
          <Button
            type="submit"
            disabled={busy || !isAuthenticatorCode(code)}
            isLoading={busy}
          >
            Verify authenticator
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setMode(null);
              setCode("");
            }}
          >
            Cancel
          </Button>
        </form>
      ) : mode ? (
        <SecurityQuestionManager
          request={request}
          preverified={preverified}
          disable={mode === "disable"}
          onCancel={() => setMode(null)}
          onComplete={() => {
            setMessage(
              mode === "disable"
                ? "Recovery questions disabled."
                : "Your three recovery questions are saved.",
            );
            setMode(null);
            void status.refetch();
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!status.data}
            isLoading={busy}
            onClick={() => void begin("edit")}
          >
            {status.data?.enabled
              ? "Replace questions"
              : "Set up recovery questions"}
          </Button>
          {status.data?.enabled && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void begin("disable")}
            >
              Disable
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
