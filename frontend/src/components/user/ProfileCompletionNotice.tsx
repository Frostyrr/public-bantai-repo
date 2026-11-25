import { useState } from "react";
import { Link } from "react-router-dom";
import type { UserProfile } from "../../lib/api";
export default function ProfileCompletionNotice({
  user,
}: {
  user: UserProfile;
}) {
  const key = `bantai_identity_notice_${user.id}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(key) === "dismissed";
    } catch {
      return false;
    }
  });
  if (user.personalIdentity?.complete || dismissed || user.onboardingStep)
    return null;
  return (
    <aside
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle bg-surface px-5 py-3 text-sm text-secondary"
    >
      <span>
        Your workspaces are ready. You can complete your private personal
        information whenever you’re ready.
      </span>
      <div className="flex items-center gap-4">
        <Link
          className="rounded underline underline-offset-4 focus-visible:ring-2"
          to="/app/settings?tab=profile"
        >
          Complete profile
        </Link>
        <button
          type="button"
          className="cursor-pointer rounded px-2 py-1 hover:text-primary focus-visible:ring-2"
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem(key, "dismissed");
            } catch {
              /* Session-only notice. */
            }
          }}
        >
          Not now
        </button>
      </div>
    </aside>
  );
}
