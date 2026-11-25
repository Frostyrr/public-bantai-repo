import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API from "../../../config/apiClient";
import Select from "../../../components/ui/Select";
import Button from "../../../components/ui/Button";
import { organizationTypes, type OrganizationType } from "../../../lib/organizationTypes";
import { formatErrorMessage } from "../../../utils/formatError";

export default function OrganizationTypeSettings({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<OrganizationType | "">("");
  const path = `/organizations/${orgId}/type`;
  const key = ["organization-type", orgId];
  const current = useQuery({
    queryKey: key,
    queryFn: async () => (await API.get<{ organizationType: OrganizationType | null }>(path)).data.organizationType,
  });
  const save = useMutation({
    mutationFn: async () => { await API.put(path, { organizationType: draft }); },
    onSuccess: () => { client.setQueryData(key, draft); setDraft(""); },
  });
  return <section className="space-y-4 rounded-xl surface-raised border border-subtle p-6 backdrop-blur-xl">
    <div>
      <h2 className="font-heading text-base font-medium text-primary">Organization Type</h2>
      <p className="mt-1 text-xs sm:text-sm text-secondary">Directory fields can be customized separately in Member Directory.</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-full max-w-sm"><Select ariaLabel="Organization type" value={draft || current.data || ""}
        placeholder="Unspecified" disabled={!current.isSuccess || save.isPending}
        options={organizationTypes.map(type => ({ value: type.value, label: type.label, description: type.description }))}
        onChange={event => { save.reset(); setDraft(event.target.value as OrganizationType); }} /></div>
      <Button variant="outline" disabled={!draft || draft === current.data} isLoading={save.isPending} onClick={() => save.mutate()}>Save Changes</Button>
    </div>
    {save.isSuccess && <p role="status" className="text-sm text-sem-success-fg">Organization type updated.</p>}
    {(save.isError || current.isError) && <p role="alert" className="text-sm text-sem-error-fg">{formatErrorMessage(save.error ?? current.error)}</p>}
  </section>;
}
