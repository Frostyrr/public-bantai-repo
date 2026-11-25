import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Monitor, UserRound } from "lucide-react";
import { useTheme, type ThemePreference } from "../../context/ThemeContext";
import { AUTH } from "../../hooks/useAuth";
import {
  completeAccountOnboarding,
  logout,
  type UserPreferences,
  type UserProfile,
} from "../../lib/api";
import { formatErrorMessage } from "../../utils/formatError";
import Button from "../ui/Button";
import PersonalIdentityFields from "./PersonalIdentityFields";
import {
  emptyIdentity,
  identityError,
  type PersonalIdentity,
} from "../../lib/identity";
import API from "../../config/apiClient";
import Modal from "../ui/Modal";
import ThemeChoices from "../ui/ThemeChoices";

const keepOpen = () => {};

export default function AccountOnboarding({ user }: { user: UserProfile }) {
  const client = useQueryClient();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isAppearance = user.onboardingStep === "appearance";
  const [identity, setIdentity] = useState(
    user.personalIdentity ?? emptyIdentity,
  );
  const [choice, setChoice] = useState<ThemePreference | null>(null);
  const [error, setError] = useState("");
  const { theme, setTheme, setPreviewTheme } = useTheme();
  const selectedTheme = choice ?? theme;

  useEffect(() => {
    if (isAppearance) headingRef.current?.focus();
  }, [isAppearance]);
  useEffect(() => () => setPreviewTheme(null), [setPreviewTheme]);

  const saveName = useMutation({
    mutationFn: async (identity: PersonalIdentity) =>
      (
        await API.put<PersonalIdentity>(
          "/user/personal-information",
          identity,
          { signal: undefined, ...{ expectedUserId: user.id } },
        )
      ).data,
    onSuccess: (identity) => {
      client.setQueryData<UserProfile | null>([AUTH], (current) =>
        current?.id === user.id
          ? {
              ...current,
              username: identity.username,
              displayName: identity.username ? `@${identity.username}` : null,
              personalIdentity: identity,
              onboardingStep: "appearance",
            }
          : current,
      );
    },
  });

  const finish = useMutation({
    mutationFn: (theme: ThemePreference) =>
      completeAccountOnboarding(theme, { expectedUserId: user.id }),
    onSuccess: async (savedTheme) => {
      const preferencesKey = ["user-preferences", user.id];
      await client.cancelQueries({ queryKey: preferencesKey });
      if (client.getQueryData<UserProfile | null>([AUTH])?.id !== user.id)
        return;
      client.setQueryData<UserPreferences>(preferencesKey, (current) =>
        current ? { ...current, theme: savedTheme } : undefined,
      );
      setTheme(savedTheme);
      setPreviewTheme(null);
      void client.invalidateQueries({ queryKey: preferencesKey });
      client.setQueryData<UserProfile | null>([AUTH], (current) =>
        current?.id === user.id
          ? { ...current, onboardingStep: null }
          : current,
      );
    },
  });
  const signOut = useMutation({ mutationFn: () => logout() });
  const busy = saveName.isPending || finish.isPending || signOut.isPending;
  const requestError = isAppearance ? finish.error : saveName.error;
  const message = error || formatErrorMessage(signOut.error || requestError);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (isAppearance) {
      finish.mutate(selectedTheme);
      return;
    }
    const problem = identityError(identity);
    if (problem) {
      setError(problem);
      return;
    }
    saveName.mutate(identity);
  }

  const Icon = isAppearance ? Monitor : UserRound;
  return (
    <Modal isOpen onClose={keepOpen} maxWidth="lg" labelledBy={titleId}>
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-subtle bg-secondary-surface text-primary">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h1
              id={titleId}
              ref={headingRef}
              tabIndex={-1}
              className="font-heading text-lg font-semibold text-primary"
            >
              {isAppearance
                ? "How should Bantai look?"
                : "Complete your personal information"}
            </h1>
            <p className="mt-0.5 text-sm text-secondary">
              {isAppearance
                ? "You can change this anytime in Account Settings."
                : "Choose your public username. Your personal names remain private; birthdate is optional."}
            </p>
          </div>
        </div>
        {isAppearance ? (
          <ThemeChoices
            value={selectedTheme}
            disabled={busy}
            onChange={(next) => {
              setChoice(next);
              setPreviewTheme(next);
            }}
          />
        ) : (
          <PersonalIdentityFields
            value={identity}
            onChange={setIdentity}
            disabled={busy}
          />
        )}
        {message && (
          <p role="alert" className="text-sm text-sem-error-fg">
            {message}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => signOut.mutate()}
          >
            Sign out
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={signOut.isPending}
            isLoading={saveName.isPending || finish.isPending}
          >
            {isAppearance ? "Open workspace" : "Continue"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
