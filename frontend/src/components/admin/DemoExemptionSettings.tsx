import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import API from "../../config/apiClient";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { formatErrorMessage } from "../../utils/formatError";

type Setting = { account_lockout: boolean; ip_restriction: boolean; expires_at: string | null; reason: string };
export default function DemoExemptionSettings() {
  const query = useQuery({ queryKey: ["demo-exemption"], queryFn: async () => (await API.get<Setting>("/admin/settings/demo-exemption")).data, refetchInterval: 30_000 });
  const [account, setAccount] = useState(false);
  const [ip, setIp] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const mutation = useMutation({ mutationFn: async (disable: boolean) => API.patch("/admin/settings/demo-exemption", { account_lockout: disable ? false : account, ip_restriction: disable ? false : ip, minutes: Number(minutes), reason }), onSuccess: () => query.refetch() });
  const active = query.data && Date.parse(query.data.expires_at ?? "") > now && (query.data.account_lockout || query.data.ip_restriction);
  return <section className="mb-6 rounded-2xl border border-subtle bg-surface p-5">
    <h3 className="text-sm font-medium text-primary">Super-admin demo exemptions</h3>
    <p className="mt-2 text-xs leading-relaxed text-secondary">Applies to your current super-admin account. Protects existing verified sessions; anonymous sign-in attempts remain restricted. MFA, suspension and session timeouts retain their existing rules.</p>
    {active && <p role="status" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">Demo exemption active until {new Date(query.data!.expires_at!).toLocaleTimeString()}. Account lockouts: {query.data!.account_lockout ? "exempt" : "enforced"}. IP restrictions: {query.data!.ip_restriction ? "exempt" : "enforced"}.</p>}
    {query.isError ? <p role="alert" className="mt-3 text-xs text-red-400">{formatErrorMessage(query.error)} Local migration and backend support are required.</p> : <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); mutation.mutate(false); }}>
      <div className="flex flex-wrap gap-5 text-sm text-primary">
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={account} onChange={event => setAccount(event.target.checked)} className="demo-exemption-checkbox" />Account lockout exemption</label>
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={ip} onChange={event => setIp(event.target.checked)} className="demo-exemption-checkbox" />IP restriction exemption</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Duration (minutes)" type="number" required min={5} max={120} value={minutes} onChange={event => setMinutes(event.target.value)} /><Input label="Reason" required minLength={3} maxLength={500} placeholder="Testing account lockouts during a demo" value={reason} onChange={event => setReason(event.target.value)} /></div>
      {mutation.isError && <p role="alert" className="text-xs text-red-400">{formatErrorMessage(mutation.error)}</p>}
      <div className="flex gap-3"><Button type="submit" disabled={query.isPending || mutation.isPending || (!account && !ip)} isLoading={mutation.isPending}>Apply demo exemptions</Button>{active && <Button type="button" variant="outline" disabled={mutation.isPending || reason.trim().length < 3} onClick={() => mutation.mutate(true)}>Disable exemptions</Button>}</div>
    </form>}
  </section>;
}
