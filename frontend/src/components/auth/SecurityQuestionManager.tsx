import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import AuthenticatorCodeInput from "./AuthenticatorCodeInput";
import RecoveryQuestionFields from "./RecoveryQuestionFields";
import { isAuthenticatorCode } from "../../lib/verificationCode";
import type { QuestionRequest } from "../../lib/securityQuestions";
import { formatErrorMessage } from "../../utils/formatError";

export default function SecurityQuestionManager({
  request,
  disable = false,
  onComplete,
  onCancel,
  preverified = false,
}: {
  request: QuestionRequest;
  disable?: boolean;
  onComplete: () => void;
  onCancel: () => void;
  preverified?: boolean;
}) {
  const [stage, setStage] = useState<"send" | "code" | "edit" | "review">(
    preverified ? "edit" : "send",
  );
  const [questions, setQuestions] = useState([1, 2, 3]);
  const [answers, setAnswers] = useState(["", "", ""]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const working = useRef(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(
      () => setCooldown((v) => Math.max(0, v - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function send() {
    void run(async () => {
      await request("/send", "POST");
      setCode("");
      setCooldown(60);
      setStage("code");
    });
  }
  return (
    <div className="recovery-question-manager space-y-4">
      <div>
        <p className="text-sm font-medium text-primary">
          {disable
            ? "Disable recovery questions"
            : "Set your three recovery questions"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-secondary">
          {disable
            ? "Confirm a fresh email code to remove your questions and saved answers. Email verification and any enrolled authenticator will still be required for recovery."
            : stage === "send" || stage === "code"
              ? "First, confirm a fresh code sent to your account email. This code only authorizes changes to recovery questions."
              : stage === "review"
                ? "Review your questions and answers before saving. Saved answers can’t be displayed later."
                : "Choose three different questions. You’ll answer all three during password recovery."}
        </p>
      </div>
      <ol
        aria-label="Setup progress"
        className="flex gap-2 text-[11px] text-secondary"
      >
        {(disable
          ? ["Verify email"]
          : [preverified ? "Verify authenticator" : "Verify email", "Choose questions", "Review"]
        ).map((label, i) => (
          <li
            key={label}
            aria-current={
              (stage === "send" || stage === "code"
                ? 0
                : stage === "edit"
                  ? 1
                  : 2) === i
                ? "step"
                : undefined
            }
            className="flex-1 border-t-2 border-subtle pt-2 aria-[current=step]:border-strong aria-[current=step]:font-medium aria-[current=step]:text-primary"
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-sem-error-border bg-sem-error-bg p-3 text-sm text-sem-error-fg"
        >
          {error}
        </p>
      )}
      {stage === "send" ? (
        <Button onClick={send} isLoading={busy}>
          Send verification code
        </Button>
      ) : stage === "code" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await request("/confirm", "POST", { code });
              setCode("");
              if (disable) {
                await request("", "DELETE");
                onComplete();
              } else setStage("edit");
            });
          }}
        >
          <AuthenticatorCodeInput
            label="Recovery question email code"
            value={code}
            onChange={setCode}
            disabled={busy}
          />
          <Button
            type="submit"
            isLoading={busy}
            disabled={!isAuthenticatorCode(code)}
          >
            {disable ? "Verify and disable" : "Verify email"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || cooldown > 0}
            onClick={send}
          >
            {cooldown ? `Resend in ${cooldown}s` : "Resend code"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (stage === "edit") {
              setStage("review");
              return;
            }
            void run(async () => {
              await request("", "PUT", { questions, answers });
              setAnswers(["", "", ""]);
              onComplete();
            });
          }}
        >
          <RecoveryQuestionFields
            questions={questions}
            answers={answers}
            onQuestions={setQuestions}
            onAnswers={setAnswers}
            disabled={busy}
            review={stage === "review"}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              isLoading={busy}
              disabled={answers.some((answer) => answer.trim().length < 2)}
            >
              {stage === "edit"
                ? "Review questions"
                : "Save recovery questions"}
            </Button>
            {stage === "review" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setStage("edit")}
              >
                Edit answers
              </Button>
            )}
          </div>
          {error && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (preverified) { onCancel(); return; }
                setStage("send");
                setError("");
              }}
            >
              {preverified ? "Verify again" : "Verify a new email code"}
            </Button>
          )}
        </form>
      )}
      <Button variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
