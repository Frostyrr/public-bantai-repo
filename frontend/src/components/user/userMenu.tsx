import Badge from "../ui/Badge";
import FloatingMenu from "../ui/FloatingMenu";
import { flushSync } from "react-dom";
import { slideSettingsPage } from "../../utils/settingsTransition";
import { navigateWithTransition } from "../../utils/navTransition";
import React, { useId, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  LogOut,
  ShieldCheck,
  ChevronDown,
  LayoutDashboard,
  Receipt,
  Settings,
} from "lucide-react";
import { logout, getUserObligations } from "../../lib/api";
import queryClient from "../../config/queryClient";
import useAuth from "../../hooks/useAuth";
import { resolveOrganizationDisplayName } from "../../lib/identity";
import { formatCompactCurrency, formatExactCurrency } from "../../utils/formatCompactPHP";

export const UserMenu: React.FC<{ compactOnMobile?: boolean;organizationDisplayName?:string|null }> = ({ compactOnMobile = false,organizationDisplayName }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const panelId = useId();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const {
    mutate: signOut,
    isPending,
    error: signOutError,
  } = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  const obligationsQuery = useQuery({
    queryKey: ["user-obligations"],
    queryFn: getUserObligations,
    enabled: !!user,
  });

  const obligations = obligationsQuery.data ?? [];
  const totalOutstandingCentavos = obligations.reduce((acc, ob) => {
    const remaining =
      ob.remaining_centavos ?? ob.amount_centavos - (ob.paid_centavos || 0);
    return acc + Math.max(0, remaining);
  }, 0);

  const userEmail = user?.email || "Account";
  const label = resolveOrganizationDisplayName(user?.username,organizationDisplayName);
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className={`relative inline-block text-left font-sans ${isOpen ? "z-[99999]" : ""}`}>
      {signOutError && (
        <p role="alert" className="text-sem-error-fg">
          Sign-out failed. Please try again.
        </p>
      )}
      {/* User Menu Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        aria-label={`Account menu for ${label}`}
        className={"flex items-center gap-2.5 h-9 px-3.5 text-sm font-medium justify-center focus-visible:ring-2 focus-visible:ring-strong rounded-full bg-elevated border border-subtle hover:border-strong text-primary transition-all hardware-sharp group cursor-pointer" + (compactOnMobile ? " max-md:size-8 max-md:shrink-0 max-md:overflow-hidden max-md:px-0" : "")}
      >
        <div className="w-6 h-6 rounded-full bg-action text-action-fg flex items-center justify-center font-semibold text-xs shadow-md transition-shadow overflow-hidden shrink-0">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={label}
              className="w-full h-full object-cover"
            />
          ) : (
            initial
          )}
        </div>
        <span className="hidden md:inline text-sm font-medium text-secondary group-hover:text-primary max-w-[160px] truncate">
          {label}
        </span>
        <ChevronDown
          className={`hidden md:block w-3.5 h-3.5 text-secondary transition-transform duration-200 ${
            isOpen ? "rotate-180 text-primary" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu Panel */}
      <FloatingMenu open={isOpen} id={panelId} mobileSpacing onClose={() => setIsOpen(false)} align="right" className="absolute right-0 mt-2 w-72 md:w-64 max-md:max-h-[80dvh] max-md:overscroll-contain rounded-2xl bg-surface border border-subtle shadow-2xl backdrop-blur-2xl p-4 md:p-2 z-[99999] hardware-sharp">
          {/* User Info Header */}
          <div className="pb-3 mb-3 md:px-3 md:py-2.5 md:mb-1 border-b border-subtle flex flex-col gap-1 md:gap-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm md:text-xs font-semibold text-primary truncate md:max-w-[180px]">
                {label}
              </span>
              {user?.verified && (
                <ShieldCheck className="w-3.5 h-3.5 text-sem-success-fg shrink-0" />
              )}
            </div>
            {user?.username && (
              <span className="text-xs md:text-[11px] font-sans text-secondary truncate md:max-w-[180px]">
                {userEmail}
              </span>
            )}
            <span className="text-[11px] md:text-[10px] font-sans font-medium text-muted uppercase tracking-wider mt-0.5">
              {user?.verified ? "Verified Account" : "Unverified Account"}
            </span>
          </div>

          {/* Navigation Actions */}
          <div className="flex flex-col gap-1">
            {/* Overall Contributions & Receipts Summary */}
            <button
              type="button"
              onClick={() => {
                flushSync(() => setIsOpen(false));
                if (location.pathname !== "/app/payments") {
                  navigateWithTransition(() => navigate("/app/payments", {
                    state: { returnTo: location.pathname + location.search + location.hash },
                  }));
                }
              }}
              className="w-full flex items-center justify-between gap-2 min-h-11 md:min-h-0 p-3 md:p-2 rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-strong active:bg-selected-surface bg-secondary-surface hover:bg-hover-surface border border-subtle hover:border-strong transition-all text-left cursor-pointer group mb-2 md:mb-1"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-white border border-subtle shadow-2xs flex items-center justify-center text-primary dark:bg-zinc-800 dark:border-transparent dark:shadow-none dark:text-zinc-300 dark:group-hover:text-white shrink-0">
                  <Receipt className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-medium text-primary flex items-center gap-1">
                    <span>Personal Ledger</span>
                  </div>
                  <div className="text-[10px] text-muted font-mono">
                    All Dues &amp; Receipts
                  </div>
                </div>
              </div>

              {totalOutstandingCentavos > 0 ? (
                <Badge >
                  <span title={formatExactCurrency(totalOutstandingCentavos, "PHP")}>
                    {formatCompactCurrency(totalOutstandingCentavos, "PHP")}
                  </span>
                </Badge>
              ) : (
                <Badge >
                  Clear
                </Badge>
              )}
            </button>

            {(user?.platformRole === "admin" || user?.platformRole === "super_admin") && (
              <button
                type="button"
                onClick={() => {
                  flushSync(() => setIsOpen(false));
                  navigateWithTransition(() => navigate("/admin"));
                }}
                className="w-full flex items-center justify-between gap-2.5 min-h-11 md:min-h-0 px-3 py-2 rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-strong active:bg-selected-surface text-xs font-medium text-secondary hover:text-primary hover:bg-hover-surface transition-colors text-left cursor-pointer"
              >
                <span className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-muted" />
                  <span>Platform Admin</span>
                </span>
                <Badge>{user?.platformRole === "super_admin" ? "Super" : "Admin"}</Badge>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                flushSync(() => setIsOpen(false));
                if (location.pathname !== "/app/settings") {
                  slideSettingsPage("forward", () => navigate("/app/settings", {
                    state: { returnTo: location.pathname + location.search + location.hash },
                  }));
                }
              }}
              className="w-full flex items-center gap-2.5 min-h-11 md:min-h-0 px-3 py-2 rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-strong active:bg-selected-surface text-xs font-medium text-secondary hover:text-primary hover:bg-hover-surface transition-colors text-left cursor-pointer"
            >
              <Settings className="w-4 h-4 text-muted" />
              <span>Account Settings</span>
            </button>

            <button
              type="button"
              onClick={() => {
                flushSync(() => setIsOpen(false));
                navigateWithTransition(() => navigate("/dashboard"));
              }}
              className="w-full flex items-center gap-2.5 min-h-11 md:min-h-0 px-3 py-2 rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-strong active:bg-selected-surface text-xs font-medium text-secondary hover:text-primary hover:bg-hover-surface transition-colors text-left cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4 text-muted" />
              <span>My Organizations</span>
            </button>

            {/* Divider */}
            <div className="my-1 border-t border-subtle" />

            {/* Logout Action */}
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsOpen(false);
                signOut();
              }}
              className="w-full flex items-center gap-2.5 min-h-11 md:min-h-0 px-3 py-2 rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-strong active:bg-sem-error-hover text-xs font-medium text-sem-error-fg hover:bg-sem-error-bg transition-colors text-left cursor-pointer"
            >
              <LogOut className="w-4 h-4 text-sem-error-fg" />
              <span>{isPending ? "Signing Out..." : "Sign Out"}</span>
            </button>
          </div>
      </FloatingMenu>
    </div>
  );
};

export default UserMenu;
