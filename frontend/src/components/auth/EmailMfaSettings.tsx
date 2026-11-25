import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import API from "../../config/apiClient";
import { formatErrorMessage } from "../../utils/formatError";
import Button from "../ui/Button";
import AuthenticatorCodeInput from "./AuthenticatorCodeInput";
import { useAutoSubmitOtp } from "../../hooks/useAutoSubmitOtp";
import { isAuthenticatorCode } from "../../lib/verificationCode";

export default function EmailMfaSettings({ userId, onChange }: { userId: string; onChange: () => void }) {
  const [message, setMessage] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [code, setCode] = useState("");
  const settings = useQuery({
    queryKey: ["email-mfa", userId],
    queryFn: async () => (await API.get<{ enabled: boolean }>("/auth/email-mfa")).data,
  });
  const change = useMutation({
    mutationFn: async (action: "send" | "confirm" | "disable") => {
      if (action === "send") await API.post("/user/email-mfa/enroll/send");
      else if (action === "confirm") await API.post("/user/email-mfa/enroll/verify", { code });
      else await API.delete("/user/email-mfa");
    },
    onSuccess: (_, action) => {
      if (action === "send") {
        setEnrolling(true);
        setCode("");
        setMessage("Check your inbox for the enrollment code.");
        return;
      }
      setEnrolling(false);
      setCode("");
      setMessage(action === "confirm" ? "Email verification enabled." : "Email verification disabled.");
      void settings.refetch();
      onChange();
    },
  });

  const { markAttempted } = useAutoSubmitOtp({
    code,
    enabled: enrolling,
    busy: change.isPending,
    onSubmit: () => {
      if (!change.isPending) change.mutate("confirm");
    },
  });

  return <section className="p-6 rounded-2xl bg-surface border border-subtle space-y-3">
    <h3 className="text-primary section-title">Email verification</h3>
    <p className="text-sm text-secondary">
      Require a sign-in code sent to your enrolled email. To enroll a different address,
      verify with the enrolled inbox or your trusted authenticator and update this setting.
    </p>
    {settings.isError && <p role="alert">Could not load email verification settings.</p>}
    {change.isError && <p role="alert">{formatErrorMessage(change.error)}</p>}
    {message && <p role="status">{message}</p>}
    {settings.data?.enabled && <Button
      type="button" isLoading={change.isPending} onClick={() => change.mutate("disable")}
    >Disable email verification</Button>}
    {settings.data?.enabled === false && <Button
      type="button" isLoading={change.isPending} onClick={() => change.mutate("send")}
    >{enrolling ? "Resend enrollment code" : "Set up email verification"}</Button>}
    {enrolling && <form onSubmit={(event) => {
      event.preventDefault();
      if (isAuthenticatorCode(code) && !change.isPending) {
        markAttempted(code);
        change.mutate("confirm");
      }
    }} className="space-y-3">
      <AuthenticatorCodeInput label="Email verification code" value={code} onChange={setCode} disabled={change.isPending} />
      <Button type="submit" disabled={change.isPending || !isAuthenticatorCode(code)} isLoading={change.isPending}>
        {change.isPending ? "Verifying..." : "Enable email verification"}
      </Button>
    </form>}
  </section>;
}
