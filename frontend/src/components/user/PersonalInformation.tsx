import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import API from "../../config/apiClient";
import {
  emptyIdentity,
  identityError,
  composePersonalName,
  type PersonalIdentity,
} from "../../lib/identity";
import type { UserProfile } from "../../lib/api";
import PersonalIdentityFields from "./PersonalIdentityFields";
import Button from "../ui/Button";
import { formatErrorMessage } from "../../utils/formatError";
export default function PersonalInformation({ user }: { user: UserProfile }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<PersonalIdentity | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const value = { ...(draft ?? user.personalIdentity ?? emptyIdentity), username: user.username ?? user.personalIdentity?.username ?? "" };
  const save = useMutation({
    mutationFn: () =>
      API.put("/user/personal-information", value, {
        signal: undefined,
        ...{ expectedUserId: user.id },
      }),
    onSuccess: async () => {
      // Username changes affect cached attribution labels across workspaces.
      await client.invalidateQueries();
      setDraft(null);
      setSaved(true);
    },
  });
  return (
    <section className="rounded-2xl border border-subtle bg-surface p-6 space-y-4">
      <div>
        <h2 className="section-title text-primary">Personal Information</h2>
        <p className="mt-1 text-xs leading-relaxed text-secondary">
          Keep your personal information separate from your public username and
          organization display names.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const problem = identityError(value);
          setError(problem ?? "");
          if (!problem) save.mutate();
        }}
      >
        <PersonalIdentityFields
          value={value}
          onChange={(next) => {
            setDraft(next);
            setSaved(false);
          }}
          disabled={save.isPending}
          birthdateLocked={Boolean(user.personalIdentity?.birthdate)}
          hideUsername
        />
        {composePersonalName(value) && (
          <p className="text-xs text-secondary">
            Private name preview: {composePersonalName(value)}
          </p>
        )}
        {(error || save.isError) && (
          <p role="alert" className="text-sm text-sem-error-fg">
            {error || formatErrorMessage(save.error)}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-secondary">
            Personal information saved.
          </p>
        )}
        <Button type="submit" isLoading={save.isPending}>
          Save personal information
        </Button>
      </form>
    </section>
  );
}
