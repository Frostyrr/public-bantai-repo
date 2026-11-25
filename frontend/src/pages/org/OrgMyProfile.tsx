import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API from "../../config/apiClient";
import useAuth from "../../hooks/useAuth";
import type { Membership, OrganizationDetails } from "../../lib/api";
import { resolveOrganizationDisplayName } from "../../lib/identity";
import { formatErrorMessage } from "../../utils/formatError";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
export default function OrgMyProfile() {
  const { organization, membership } = useOutletContext<{
    organization: OrganizationDetails;
    membership: Membership;
  }>();
  const { user } = useAuth();
  const client = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const profile = useQuery({
    queryKey: ["org-my-profile", organization.id, user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () =>
      (
        await API.get<{ display_name: string | null }>(
          `/organizations/${organization.id}/my-profile`,
          { signal: undefined, ...{ expectedUserId: user?.id } },
        )
      ).data,
  });
  const value = draft ?? profile.data?.display_name ?? "";
  const save = useMutation({
    mutationFn: (displayName: string) =>
      API.patch(`/organizations/${organization.id}/my-profile`, {
        displayName,
      }, { signal: undefined, ...{ expectedUserId: user?.id } }),
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) =>
          query.queryKey.includes(organization.id) ||
          query.queryKey[0] === "organizations",
      });
      setDraft(null);
      setSaved(true);
    },
  });
  return (
    <div className="page-shell workspace-page space-y-6">
      <header>
        <h1 className="page-title">My Profile</h1>
        <p className="page-subtitle">Your identity in {organization.name}.</p>
      </header>
      <section className="max-w-xl rounded-2xl border border-subtle bg-surface p-6 space-y-5">
        <div className="rounded-xl border border-subtle bg-elevated p-4">
          <p className="text-lg font-medium text-primary">
            {resolveOrganizationDisplayName(user?.username, value)}
          </p>
          <p className="mt-1 text-xs text-secondary">
            {user?.username
              ? `@${user.username}`
              : "Choose a username in Account Settings"}{" "}
            · {membership.role.replace(/_/g, " ")}
          </p>
          <p className="mt-1 text-xs text-secondary">{organization.name}</p>
        </div>
        <p className="text-sm leading-relaxed text-secondary">
          Your display name is how other members see you in this organization.
          It won’t change your Bantai username or your identity in other
          organizations.
        </p>
        {profile.isPending ? (
          <p role="status">Loading your profile…</p>
        ) : profile.isError ? (
          <div>
            <p role="alert">Could not load your organization profile.</p>
            <Button onClick={() => void profile.refetch()}>Try again</Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(value.trim());
            }}
          >
            <Input
              label="Organization display name (optional)"
              value={value}
              maxLength={80}
              disabled={save.isPending}
              placeholder={resolveOrganizationDisplayName(user?.username)}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaved(false);
              }}
            />
            <p className="text-xs text-secondary">
              Leave blank to use your username. Display names do not have to be
              unique.
            </p>
            {save.isError && (
              <p role="alert" className="text-sm text-sem-error-fg">
                {formatErrorMessage(save.error)}
              </p>
            )}
            {saved && (
              <p role="status" className="text-sm text-secondary">
                Your organization profile is saved.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" isLoading={save.isPending}>
                Save display name
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending || !value}
                onClick={() => {
                  setDraft("");
                  save.mutate("");
                }}
              >
                Clear display name
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
