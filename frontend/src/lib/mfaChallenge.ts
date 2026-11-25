import type { QueryClient } from "@tanstack/react-query";

export type MfaMethod = "totp" | "email";
export interface EmailChallengeState {
  sent: boolean;
  resendAfter: number;
  expiresAt: number;
  error: string;
}
export const emailChallengeKey = (sessionId: string) => ["email-mfa-challenge", sessionId] as const;

export function initialMfaMethod(totp: boolean, email: boolean): MfaMethod | null {
  return totp === email ? null : totp ? "totp" : "email";
}

/** Session-scoped React Query data shares in-flight sends and cooldowns across mounts. */
export async function requestEmailChallenge(
  client: QueryClient,
  sessionId: string,
  send: () => Promise<unknown>,
  describeError: (error: unknown) => string,
  resend = false,
  now = () => Date.now(),
): Promise<EmailChallengeState> {
  const queryKey = emailChallengeKey(sessionId);
  const previous = client.getQueryData<EmailChallengeState>(queryKey);
  if (previous && (previous.resendAfter > now() || (!resend && previous.sent && previous.expiresAt > now()))) return previous;
  return client.fetchQuery({
    queryKey,
    staleTime: 0,
    retry: false,
    networkMode: "always",
    gcTime: 15 * 60_000,
    queryFn: async () => {
      const started = now();
      try {
        await send();
        return { sent: true, resendAfter: now() + 60_000, expiresAt: started + 5 * 60_000, error: "" };
      } catch (error) {
        // A delivery failure may still have consumed the server-side issuance slot.
        return { sent: false, resendAfter: now() + 60_000, expiresAt: 0, error: describeError(error) };
      }
    },
  });
}
