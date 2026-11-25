import { QueryClient } from "@tanstack/react-query";
import { extractApiErrorDetails } from "./sessionRecovery";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
for (const key of ['organizations', 'organization-members', 'organization-periods', 'organization-spaces']) {
  queryClient.setQueryDefaults([key], { staleTime: 60_000 });
}
// All consumers use the same freshness policy; writes still invalidate immediately.
queryClient.setQueryDefaults(['auth'], {
  // Session restoration reads local state too. Let our bounded checks finish
  // instead of leaving the homepage pending while the browser reports offline.
  networkMode: 'always',
  staleTime: 30_000,
  // Retrying an unresolved MFA challenge replaces it with the workspace loader,
  // discarding the selected method, sent email code state, and resend cooldown.
  // Verification explicitly refetches auth when the challenge is completed.
  refetchOnWindowFocus: query => extractApiErrorDetails(query.state.error).code !== 'mfa_required',
  refetchOnReconnect: query => extractApiErrorDetails(query.state.error).code !== 'mfa_required',
});
queryClient.setQueryDefaults(['user-obligations'], { staleTime: 30_000 });
export default queryClient;
