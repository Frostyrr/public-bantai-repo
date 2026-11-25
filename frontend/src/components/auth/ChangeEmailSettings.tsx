import { useState, type FormEvent } from "react";
import { requestEmailChange } from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import Input from "../ui/Input";
import Button from "../ui/Button";

export default function ChangeEmailSettings({ email }: { email: string }) {
  const [nextEmail, setNextEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const requestedEmail = nextEmail.trim();
    setError("");
    setSentTo("");
    if (!requestedEmail || requestedEmail.toLowerCase() === email.toLowerCase()) {
      setError("Enter an email address different from your current one.");
      return;
    }
    setBusy(true);
    try {
      await requestEmailChange(requestedEmail);
      setSentTo(requestedEmail);
      setNextEmail("");
    } catch (error) { setError(formatErrorMessage(error)); }
    finally { setBusy(false); }
  }

  return <section className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-4">
    <div>
      <h2 className="text-primary section-title">Change email address</h2>
      <p className="text-xs text-secondary mt-0.5 break-all">Current address {email}</p>
    </div>
    <form onSubmit={submit} className="space-y-3 max-w-md">
      <Input label="New email address" type="email" autoComplete="email" value={nextEmail} required disabled={busy}
        onChange={event => setNextEmail(event.target.value)} />
      <Button type="submit" size="sm" isLoading={busy}>Send confirmation</Button>
    </form>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {sentTo && <p role="status" className="text-sm text-secondary break-words">
      Check {sentTo} and your current inbox. Open any confirmation links you receive in this browser. Your address stays the same until confirmation is complete.
    </p>}
  </section>;
}
