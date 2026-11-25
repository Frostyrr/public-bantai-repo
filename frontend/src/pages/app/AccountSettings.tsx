import { assessPassword } from "../../lib/passwordPolicy";
import {parsePasswordHistoryStatus} from "../../lib/passwordHistoryStatus";
import PasswordStrength from "../../components/auth/PasswordStrength";
import Badge from "../../components/ui/Badge";
import {
  AnimatedAlertTriangleIcon,
  AnimatedBellIcon,
  AnimatedLogOutIcon,
  AnimatedShieldIcon,
  AnimatedSlidersIcon,
  AnimatedUserIcon,
} from "../../components/ui/SidebarAnimatedIcons";
import { notificationSoundsEnabled, setNotificationSounds } from "../../lib/notificationSound";
import { showFormErrors } from "../../lib/formValidation";
import { toast } from "../../lib/toast";
import React, { useEffect, useState } from "react";
import { slideSettingsPage } from "../../utils/settingsTransition";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Upload,
  Trash2,
  Lock,
  ExternalLink,
  ShieldCheck,
  LogOut,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Button from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import ThemeChoices from "../../components/ui/ThemeChoices";
import Modal from "../../components/ui/Modal";
import { useTheme, type ThemePreference } from "../../context/ThemeContext";
import { GoogleIcon } from "../../components/ui/SocialIcons";
import { getOrgCoverAndLogo } from "../../utils/organizationTheme";
import useAuth, { AUTH, type UserProfile } from "../../hooks/useAuth";
import queryClient from "../../config/queryClient";
import { formatErrorMessage } from "../../utils/formatError";
import { compressImageFile } from "../../utils/compressImage";
import EmailMfaSettings from "../../components/auth/EmailMfaSettings";
import AuthenticatorSettings from "../../components/auth/AuthenticatorSettings";
import SecurityQuestionsSettings from "../../components/auth/SecurityQuestionsSettings";
import API from "../../config/apiClient";
import GlobalUsername from "../../components/user/GlobalUsername";
import PersonalInformation from "../../components/user/PersonalInformation";
import ChangeEmailSettings from "../../components/auth/ChangeEmailSettings";
import {
  updateUserProfile,
  getUserPreferences,
  updateUserPreferences,
  getOrganizations,
  leaveOrganization,
  deleteAccount,
  changePassword,
  setInitialPassword,
  requestPasswordChangeCode,
  logout,
  type Membership,
} from "../../lib/api";

type SettingsTab =
  | "profile"
  | "security"
  | "notifications"
  | "appearance"
  | "management";

export default function AccountSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refetch } = useAuth();
  const recoveryQuestionsQuery = useQuery({
    queryKey: ["security-questions", user?.id],
    queryFn: async () => (await API.get<{enabled: boolean}>("/user/security-questions")).data,
    enabled: Boolean(user?.id),
  });
  const passwordHistoryQuery=useQuery({queryKey:["password-history",user?.id],queryFn:async()=>parsePasswordHistoryStatus((await API.get("/auth/password-history/status")).data),enabled:Boolean(user?.id)});
  const trackedHistoryQuery=useQuery({queryKey:["tracked-password-history",user?.id],queryFn:async()=>(await API.get<{stale:boolean;coverageGap:number}>("/user/password-history")).data,enabled:Boolean(user?.id&&passwordHistoryQuery.data?.enabled)});
  const [passwordAuthorization,setPasswordAuthorization]=useState("");
  const [purposeCode,setPurposeCode]=useState("");

  const openSecurity = new URLSearchParams(location.search).get("tab") === "security";
  const [activeTab, setActiveTab] = useState<SettingsTab>(openSecurity ? "security" : "profile");
  const [mobileView, setMobileView] = useState<"menu" | "detail">(openSecurity ? "detail" : "menu");

  // Profile Form State
  const displayName = user?.username ? user.username.replace(/^@/, "") : "Account";

  const [avatarInput, setAvatarInput] = useState<string | null | undefined>(
    undefined,
  );
  const avatarPreview =
    avatarInput !== undefined ? avatarInput : user?.avatarUrl || null;

  const [profileErrorMsg, setProfileErrorMsg] = useState("");
  const [copiedId, setCopiedId] = useState(false);

  // Security Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrorMsg, setPasswordErrorMsg] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordCodeRequired, setPasswordCodeRequired] = useState(false);
  const [passwordCode, setPasswordCode] = useState("");
  const [showSetLocalPassword, setShowSetLocalPassword] = useState(false);

  // Appearance & Preferences State
  const { theme: activeThemeMode, setTheme: setAppTheme, setPreviewTheme } = useTheme();
  const [themeInput, setThemeInput] = useState<ThemePreference | null>(null);
  const [reducedMotionInput, setReducedMotionInput] = useState<boolean | null>(
    null,
  );
  const [defaultOrgInput, setDefaultOrgInput] = useState<
    string | null | undefined
  >(undefined);
  const [prefsErrorMsg, setPrefsErrorMsg] = useState("");

  // Notification Preferences State
  const [notifOverrides, setNotifOverrides] = useState<Record<string, boolean>>(
    {},
  );
  const [notifErrorMsg, setNotifErrorMsg] = useState("");

  // Leave Org Modal State
  const [leavingOrg, setLeavingOrg] = useState<Membership | null>(null);
  const [leaveErrorMsg, setLeaveErrorMsg] = useState("");

  // Delete Account Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [deleteErrorMsg, setDeleteErrorMsg] = useState("");

  // Queries
  const preferencesQuery = useQuery({
    queryKey: ["user-preferences", user?.id],
    queryFn: ({ signal }) => getUserPreferences({ expectedUserId: user!.id, signal }),
    enabled: !!user,
  });

  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: getOrganizations,
    enabled: !!user,
  });

  const origin = location.state?.returnTo;
  const returnPath = typeof origin === "string" ? origin.split(/[?#]/, 1)[0] : "";
  const originOrg = returnPath.match(/^\/app\/org\/([a-z0-9-]+)(?:\/(?:overview|contributions|spaces|members|settings|archives|directory|collections(?:\/[a-z0-9-]+)?|budgets|expenses|approvals|liquidation|reports|audit-logs))?\/?$/i)?.[1];
  const isPersonalOrigin = ["/app", "/app/organizations", "/app/payments", "/dashboard"].includes(returnPath);
  const originMembership = organizationsQuery.data?.find(membership => membership.organization_id === originOrg);
  const officerPage = /\/(settings|approvals|audit-logs)\/?$/.test(returnPath);
  const canReturnToOrg = Boolean(originOrg && originMembership?.organizations && (
    !officerPage || ["owner", "organization_admin", "treasurer", "auditor"].includes(originMembership.role)
  ));
  const returnTo = isPersonalOrigin || canReturnToOrg ? origin : "/dashboard";
  const returnLabel = canReturnToOrg ? "Back to " + originMembership?.organizations?.name : "Back to My Organizations";
  const isCheckingOrigin = Boolean(originOrg && organizationsQuery.isPending);

  const goBack = () => {
    slideSettingsPage("back", () => {
      if ((isPersonalOrigin || canReturnToOrg) && window.history.state?.idx > 0) {
        navigate(-1);
      } else {
        navigate(returnTo, { replace: true });
      }
    });
  };

  const prefs = preferencesQuery.data;
  const theme = themeInput ?? prefs?.theme ?? activeThemeMode;
  useEffect(() => {
    if (activeTab !== "appearance" || themeInput === null) return;
    setPreviewTheme(themeInput);
    return () => setPreviewTheme(null);
  }, [activeTab, themeInput, setPreviewTheme]);
  const reducedMotion =
    reducedMotionInput !== null
      ? reducedMotionInput
      : Boolean(prefs?.reduced_motion);
  const defaultOrgId =
    defaultOrgInput !== undefined
      ? defaultOrgInput
      : prefs?.default_organization_id || null;

  const notifications = {
    email_approvals:
      notifOverrides.email_approvals ??
      prefs?.notifications?.email_approvals ??
      true,
    email_payments:
      notifOverrides.email_payments ??
      prefs?.notifications?.email_payments ??
      true,
    email_invites:
      notifOverrides.email_invites ??
      prefs?.notifications?.email_invites ??
      true,
    in_app_approvals:
      notifOverrides.in_app_approvals ??
      prefs?.notifications?.in_app_approvals ??
      true,
    in_app_payments:
      notifOverrides.in_app_payments ??
      prefs?.notifications?.in_app_payments ??
      true,
    in_app_invites:
      notifOverrides.in_app_invites ??
      prefs?.notifications?.in_app_invites ??
      true,
  };

  // Mutations
  const updateProfileMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateUserProfile>[0]) =>
      updateUserProfile(payload, { expectedUserId: user!.id }),
    onSuccess: async () => {
      toast.success("Profile updated");
      await queryClient.invalidateQueries({ queryKey: [AUTH] });
      setProfileErrorMsg("");
    },
    onError: (err) => {
      setProfileErrorMsg(formatErrorMessage(err));
    },
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateUserPreferences>[0]) =>
      updateUserPreferences(payload, { expectedUserId: user!.id }),
    onSuccess: async saved => {
      if (queryClient.getQueryData<UserProfile | null>([AUTH])?.id !== user?.id) return;
      queryClient.setQueryData(["user-preferences", user?.id], saved);
      setAppTheme(saved.theme);
      setThemeInput(null);
      toast.success("Preferences saved");
      await queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
      setPrefsErrorMsg("");
    },
    onError: (err) => {
      setPrefsErrorMsg(formatErrorMessage(err));
    },
  });

  const updateNotificationsMutation = useMutation({
    mutationFn: (newNotifs: Record<string, boolean>) =>
      updateUserPreferences({ notifications: newNotifs }, { expectedUserId: user!.id }),
    onSuccess: async () => {
      toast.success("Notification settings saved");
      await queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
      setNotifErrorMsg("");
    },
    onError: (err) => {
      setNotifErrorMsg(formatErrorMessage(err));
    },
  });

  const signOutMutation = useMutation({
    mutationFn: (scope: "local" | "global") => logout(scope),
    onSuccess: () => {
      queryClient.clear();
      navigate("/", { replace: true });
    },
    onError: (err) => toast.error(formatErrorMessage(err)),
  });

  const leaveOrgMutation = useMutation({
    mutationFn: leaveOrganization,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setLeavingOrg(null);
      setLeaveErrorMsg("");
    },
    onError: (err) => {
      setLeaveErrorMsg(formatErrorMessage(err));
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async () => {
      try {
        await logout();
      } catch {
        // Clear local storage and tokens regardless
      }
      queryClient.clear();
      window.location.assign("/login");
    },
    onError: (err) => {
      setDeleteErrorMsg(formatErrorMessage(err));
    },
  });

  // Handlers
  const handleProfileSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (showFormErrors(e.currentTarget)) return;
    setProfileErrorMsg("");
    updateProfileMutation.mutate({
      avatarUrl: avatarPreview,
    });
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setProfileErrorMsg("Please choose a valid JPG, PNG, or WebP image.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setProfileErrorMsg("Avatar image file size must be less than 5MB.");
      return;
    }

    void compressImageFile(file, { maxDimension: 512, maxLength: 180_000 })
      .then(({ dataUrl }) => {
        setAvatarInput(dataUrl);
        setProfileErrorMsg("");
      })
      .catch((err: unknown) => {
        setProfileErrorMsg(err instanceof Error ? err.message : "Failed to process image file.");
      });
  };

  const handleRemoveAvatar = () => {
    setAvatarInput(null);
    updateProfileMutation.mutate({
      avatarUrl: null,
    });
  };

  const handleCopyId = () => {
    if (!user?.id) return;
    navigator.clipboard.writeText(user.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  async function sendPasswordCode() {
    await requestPasswordChangeCode();
    toast.success("Check your email for a verification code.");
  }

  const handlePasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (passwordBusy || showFormErrors(e.currentTarget)) return;
    setPasswordErrorMsg("");

    const passwordError = assessPassword(newPassword).error;
    if (passwordError) {
      setPasswordErrorMsg(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordErrorMsg("Passwords do not match.");
      return;
    }

    setPasswordBusy(true);
    try {
      if (isGoogleAuth) {
        await setInitialPassword(newPassword, passwordCodeRequired ? passwordCode : undefined, passwordAuthorization || undefined);
        toast.success("Local password set. You can now sign in with Google or your password.");
        setShowSetLocalPassword(false);
        void queryClient.invalidateQueries({ queryKey: [AUTH] });
        void queryClient.invalidateQueries({ queryKey: ["password-history", user?.id] });
      } else {
        await changePassword(newPassword, currentPassword, passwordCodeRequired ? passwordCode : undefined,passwordAuthorization||undefined);
        toast.success("Password updated");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordCode("");
      setPasswordCodeRequired(false);
      setPasswordAuthorization("");setPurposeCode("");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "reauthentication_needed") {
        setPasswordCodeRequired(true);
        try { await sendPasswordCode(); }
        catch (sendError) { setPasswordErrorMsg(formatErrorMessage(sendError)); }
      } else {
        setPasswordErrorMsg(formatErrorMessage(error));
      }
    } finally {
      setPasswordBusy(false);
    }
  };

  const handlePreferencesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPrefsErrorMsg("");

    updatePreferencesMutation.mutate({
      theme: themeInput ?? undefined,
      reducedMotion: reducedMotionInput ?? undefined,
      defaultOrganizationId: defaultOrgInput,
    });
  };

  const handleNotificationToggle = (key: keyof typeof notifications) => {
    const updated = {
      ...notifications,
      [key]: !notifications[key],
    };
    setNotifOverrides(updated);
    updateNotificationsMutation.mutate(updated);
  };

  const memberships: Membership[] = organizationsQuery.data ?? [];
  const soleOwnerOrgs = memberships.filter((m) => m.role === "owner");

  const providers = user?.providers ?? ["email"];
  const isGoogleAuth =
    providers.includes("google") && !providers.includes("email");
  const isGoogleLinked = providers.includes("google");

  const createdDate = user?.createdAt ? new Date(user.createdAt) : null;
  const formattedDate =
    createdDate && !Number.isNaN(createdDate.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }).format(createdDate)
      : "Recently";

  const initials = (displayName || user?.email || "U").charAt(0).toUpperCase();

  const openMobileSection = (tab: SettingsTab) => {
    setActiveTab(tab);
    setMobileView("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-[calc(100dvh-var(--workspace-navbar-height,3.5rem))] workspace-canvas text-primary flex flex-col font-body font-normal relative">
      {/* Top Application Header (Desktop) */}


      {mobileView === "detail" && <button type="button" onClick={() => setMobileView("menu")}
        className="mx-6 mt-4 inline-flex items-center gap-1.5 self-start text-xs text-secondary hover:text-primary md:hidden">
        <ChevronLeft size={14} />Back to Settings
      </button>}

      {/* Main Settings Body */}
      <main className="flex-1 workspace-gutters workspace-page max-w-7xl w-full mx-auto space-y-6 relative z-10 overflow-x-hidden md:overflow-visible">
        <div className="border-b border-subtle pb-4">
          <button type="button" onClick={goBack} disabled={isCheckingOrigin}
            className="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary disabled:opacity-50">
            <ArrowLeft size={14} />{returnLabel}
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] md:text-[30px] leading-[1.2] tracking-[-0.02em]"><span className="text-display-gradient">Account Settings</span></h1>
            <Badge variant="context">Personal Account</Badge>
          </div>
        </div>


        {/* Mobile Settings Index Menu (slides right when detail opens, slides back when returning) */}
        <div
          aria-hidden={mobileView !== "menu"}
          className={`md:hidden space-y-6 pt-1 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
            mobileView === "menu"
              ? "translate-x-0 opacity-100 relative"
              : "translate-x-full opacity-0 pointer-events-none absolute inset-x-4 top-4"
          }`}
        >
          {/* Account Section */}
          <div className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted px-1 section-title">
              Account
            </h2>
            <button
              type="button"
              onClick={() => openMobileSection("profile")}
              className="w-full flex items-center justify-between p-4 rounded-2xl bg-surface border border-subtle hover:border-strong shadow-xs dark:shadow-none active:scale-[0.99] transition-all text-left cursor-pointer"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt={displayName || "User"}
                    className="w-12 h-12 rounded-full object-cover border border-subtle shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-elevated border border-subtle flex items-center justify-center text-sm font-medium text-primary shrink-0">
                    {initials}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-primary truncate">
                    {displayName || user?.email || "User"}
                  </div>
                  <div className="text-xs text-secondary mt-0.5">
                    Personal info
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted shrink-0" />
            </button>
          </div>

          {/* Settings Section */}
          <div className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted px-1 section-title">
              Settings
            </h2>
            <div className="rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none divide-y divide-subtle overflow-hidden">
              <button
                type="button"
                onClick={() => openMobileSection("security")}
                className="group w-full flex items-center justify-between px-4 py-3.5 hover:bg-elevated active:bg-elevated transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <AnimatedShieldIcon className="w-4 h-4 text-secondary shrink-0" />
                  <span className="text-sm font-medium text-primary">
                    Security &amp; Sign-in
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => openMobileSection("notifications")}
                className="group w-full flex items-center justify-between px-4 py-3.5 hover:bg-elevated active:bg-elevated transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <AnimatedBellIcon className="w-4 h-4 text-secondary shrink-0" />
                  <span className="text-sm font-medium text-primary">
                    Notifications
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => openMobileSection("appearance")}
                className="group w-full flex items-center justify-between px-4 py-3.5 hover:bg-elevated active:bg-elevated transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <AnimatedSlidersIcon className="w-4 h-4 text-secondary shrink-0" />
                  <span className="text-sm font-medium text-primary">
                    Appearance
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => openMobileSection("management")}
                className="group w-full flex items-center justify-between px-4 py-3.5 hover:bg-elevated active:bg-elevated transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <AnimatedAlertTriangleIcon className="w-4 h-4 text-secondary shrink-0" />
                  <span className="text-sm font-medium text-primary">
                    Account &amp; Memberships
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>

              <button
                type="button"
                onClick={async () => {
                  await logout();
                  queryClient.clear();
                  navigate("/", { replace: true });
                }}
                className="group w-full flex items-center justify-between px-4 py-3.5 hover:bg-red-500/10 active:bg-red-500/15 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <AnimatedLogOutIcon className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
                    Log out
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>
            </div>
          </div>
        </div>

        {/* Layout: Sidebar Navigation + Content Panel */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-start">
          {/* Secondary Settings Navigation (Desktop) */}
          <nav className="hidden md:flex md:flex-col gap-1.5 pb-0">
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium border outline-none select-none transition-colors duration-150 text-left whitespace-nowrap cursor-pointer ${
                activeTab === "profile"
                  ? "bg-surface text-primary border-subtle shadow-xs dark:shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-elevated border-transparent"
              }`}
            >
              <AnimatedUserIcon className="w-4 h-4 text-muted" />
              <span>Profile &amp; Identity</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("security")}
              className={`group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium border outline-none select-none transition-colors duration-150 text-left whitespace-nowrap cursor-pointer ${
                activeTab === "security"
                  ? "bg-surface text-primary border-subtle shadow-xs dark:shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-elevated border-transparent"
              }`}
            >
              <AnimatedShieldIcon className="w-4 h-4 text-muted" />
              <span>Security &amp; Sign-in</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("notifications")}
              className={`group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium border outline-none select-none transition-colors duration-150 text-left whitespace-nowrap cursor-pointer ${
                activeTab === "notifications"
                  ? "bg-surface text-primary border-subtle shadow-xs dark:shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-elevated border-transparent"
              }`}
            >
              <AnimatedBellIcon className="w-4 h-4 text-muted" />
              <span>Notifications</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("appearance")}
              className={`group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium border outline-none select-none transition-colors duration-150 text-left whitespace-nowrap cursor-pointer ${
                activeTab === "appearance"
                  ? "bg-surface text-primary border-subtle shadow-xs dark:shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-elevated border-transparent"
              }`}
            >
              <AnimatedSlidersIcon className="w-4 h-4 text-muted" />
              <span>Appearance</span>
            </button>

            <div className="my-2 border-t border-subtle hidden md:block" />

            <button
              type="button"
              onClick={() => setActiveTab("management")}
              className={`group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium border outline-none select-none transition-colors duration-150 text-left whitespace-nowrap cursor-pointer ${
                activeTab === "management"
                  ? "bg-surface text-primary border-subtle shadow-xs dark:shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-elevated border-transparent"
              }`}
            >
              <AnimatedAlertTriangleIcon className="w-4 h-4 text-muted" />
              <span>Account &amp; Memberships</span>
            </button>
          </nav>

          {/* Main Content Area (on mobile, slides in from left when detail is open) */}
          <div
            className={`md:col-span-3 space-y-6 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:translate-x-0 md:opacity-100 md:pointer-events-auto md:static ${
              mobileView === "detail"
                ? "translate-x-0 opacity-100 relative"
                : "-translate-x-full opacity-0 pointer-events-none absolute inset-x-4 top-4"
            }`}
          >
            {/* TAB 1: PROFILE & IDENTITY */}
            {activeTab === "profile" && (
              <div className="space-y-6">
                {/* Profile Card */}
                <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-6">
                  <div>
                    <h2 className="text-primary section-title">
                      Public Account
                    </h2>
                    <p className="text-xs text-secondary mt-0.5">
                      Your identity and public information visible across all
                      organizations you join.
                    </p>
                  </div>


                  {profileErrorMsg && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                      <span>{profileErrorMsg}</span>
                    </div>
                  )}

                  {/* Avatar Upload & Preview */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-5 pb-6 border-b border-subtle">
                    <div className="w-20 h-20 rounded-2xl bg-elevated border border-subtle flex items-center justify-center font-semibold text-2xl text-primary shadow-md overflow-hidden shrink-0">
                      {avatarPreview ? (
                        <img
                          src={avatarPreview}
                          alt="Avatar"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        initials
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-primary flex items-center gap-2">
                        <span>Profile Photo</span>
                        {isGoogleLinked && (
                          <Badge >
                            <GoogleIcon className="w-2.5 h-2.5" />
                            Google Connected
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-secondary max-w-sm">
                        Supports JPG, PNG, or WebP up to 2MB. A Google profile
                        picture is linked automatically when available.
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-elevated hover:bg-surface border border-subtle hover:border-strong text-xs font-medium text-primary transition-colors">
                          <Upload className="w-3.5 h-3.5 text-secondary" />
                          <span>Upload Photo</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleAvatarFileSelect}
                            className="hidden"
                          />
                        </label>

                        {avatarPreview && (
                          <button
                            type="button"
                            onClick={handleRemoveAvatar}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-elevated hover:bg-red-500/10 border border-subtle hover:border-red-500/30 text-xs font-medium text-secondary hover:text-red-600 dark:hover:text-red-300 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Form */}
                  {user && <GlobalUsername key={user.id+user.username} username={user.username ?? ""} userId={user.id}/>}
                  <form onSubmit={handleProfileSubmit} className="space-y-4">


                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-body text-xs sm:text-sm text-secondary font-normal">
                          Verified Email Address
                        </label>
                        {isGoogleLinked && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-secondary">
                            <GoogleIcon className="w-3 h-3" />
                            <span>Sign-in enabled with Google</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-elevated border border-subtle text-xs text-secondary font-mono">
                        <span className="truncate">{user?.email}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {isGoogleLinked && (
                            <Badge >
                              <GoogleIcon className="w-2.5 h-2.5" />
                              Google
                            </Badge>
                          )}
                          <Badge >
                            <ShieldCheck className="w-3 h-3" />
                            Verified
                          </Badge>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted mt-1">
                        Primary email managed securely by Supabase
                        Authentication. Used for security alerts and receipts.
                      </p>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        isLoading={updateProfileMutation.isPending}
                      >
                        Save Profile Changes
                      </Button>
                    </div>
                  </form>
                </div>

                {user&&<PersonalInformation key={user.id} user={user}/>}


                {/* Account Metadata Card */}
                <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-4">
                  <h3 className="text-sm font-heading font-medium text-primary">
                    Account Identity &amp; Metadata
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 rounded-xl bg-elevated border border-subtle">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted block mb-1">
                        Account Identifier
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-secondary truncate text-[11px]">
                          {user?.id}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyId}
                          className="p-1 rounded hover:bg-surface text-secondary hover:text-primary transition-colors cursor-pointer shrink-0"
                          title="Copy User ID"
                        >
                          {copiedId ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-elevated border border-subtle">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted block mb-1">
                        Registration Date
                      </span>
                      <span className="text-secondary font-sans">
                        Member since {formattedDate}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-elevated border border-subtle sm:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted block mb-1.5">
                        Linked Authentication Provider
                      </span>
                      <div className="flex items-center justify-between gap-3">
                        {isGoogleLinked ? (
                          <div className="flex items-center gap-2.5 text-xs text-primary">
                            <div className="w-7 h-7 rounded-lg bg-surface border border-subtle flex items-center justify-center shrink-0">
                              <GoogleIcon className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="font-medium text-primary block">
                                Google Single Sign-On
                              </span>
                              <span className="text-[11px] font-mono text-secondary">
                                Linked account: {user?.email}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5 text-xs text-primary">
                            <div className="w-7 h-7 rounded-lg bg-surface border border-subtle flex items-center justify-center shrink-0">
                              <Lock className="w-3.5 h-3.5 text-secondary" />
                            </div>
                            <div>
                              <span className="font-medium text-primary block">
                                Email &amp; Password
                              </span>
                              <span className="text-[11px] font-mono text-secondary">
                                Direct Supabase credentials
                              </span>
                            </div>
                          </div>
                        )}

                        <Badge >
                          Connected
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SECURITY & SIGN-IN */}
            {activeTab === "security" && (
              <div className="space-y-6">
                  {isGoogleLinked && <Badge variant="context"><GoogleIcon className="size-3.5" />Google Account Linked</Badge>}

                {/* Connected Providers Card */}
                <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-4">
                  <div>
                    <h2 className="text-primary section-title">
                      Authentication Providers
                    </h2>
                    <p className="text-xs text-secondary mt-0.5">
                      Identity services currently linked to your Bantai account.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {providers.includes("google") && (
                      <div className="p-4 rounded-xl bg-elevated border border-subtle flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-surface border border-subtle flex items-center justify-center">
                            <GoogleIcon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-primary">
                              Google OAuth
                            </div>
                            <div className="text-[11px] text-secondary">
                              Single Sign-On
                            </div>
                          </div>
                        </div>
                        <Badge >
                          Connected
                        </Badge>
                      </div>
                    )}

                    {providers.includes("email") && (
                      <div className="p-4 rounded-xl bg-elevated border border-subtle flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-surface border border-subtle flex items-center justify-center text-secondary">
                            <Lock className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-primary">
                              Email &amp; Password
                            </div>
                            <div className="text-[11px] text-secondary">
                              Direct Authentication
                            </div>
                          </div>
                        </div>
                        <Badge >
                          Active
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>

                <AuthenticatorSettings />
                {user && <SecurityQuestionsSettings userId={user.id} />}
                {user && <EmailMfaSettings userId={user.id} onChange={() => void refetch()} />}
                {!isGoogleAuth && user?.email && <ChangeEmailSettings email={user.email} />}

                {/* Password Management */}
                {isGoogleAuth ? (
                  <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-heading font-medium text-primary">
                          Federated Authentication Managed by Google
                        </h3>
                        <p className="text-xs text-secondary">
                          You sign in using your verified Google credentials.
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-secondary leading-relaxed pt-2">
                      Because your account was created with Google Single
                      Sign-On, password management and multi-factor
                      authentication are enforced directly through your Google
                      Account. A local Bantai password is not required.
                    </p>

                    <div className="pt-3 border-t border-subtle space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-medium text-primary">
                            Backup sign-in password (Optional)
                          </h4>
                          <p className="text-[11px] text-secondary mt-0.5">
                            Add a local password if you also want to sign in with your email and password.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowSetLocalPassword((prev) => !prev);
                            setPasswordErrorMsg("");
                          }}
                        >
                          {showSetLocalPassword ? "Cancel" : "Set a password"}
                        </Button>
                      </div>

                      {showSetLocalPassword && (
                        <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md pt-1">
                          {passwordErrorMsg && (
                            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                              <span>{passwordErrorMsg}</span>
                            </div>
                          )}

                          {passwordHistoryQuery.data?.enabled && (
                            <div className="space-y-3 rounded-xl border border-subtle p-4">
                              <p className="text-xs text-secondary">
                                Verify a fresh email code to authorize setting a local password.
                              </p>
                              {!passwordAuthorization && (
                                <Input
                                  label="Verification code"
                                  inputMode="numeric"
                                  autoComplete="one-time-code"
                                  value={purposeCode}
                                  onChange={(e) => setPurposeCode(e.target.value)}
                                  disabled={passwordBusy}
                                />
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={passwordBusy}
                                onClick={async () => {
                                  setPasswordBusy(true);
                                  setPasswordErrorMsg("");
                                  try {
                                    if (purposeCode && !passwordAuthorization) {
                                      const { data } = await API.post<{ authorization: string }>("/user/password-history/confirm", { code: purposeCode });
                                      setPasswordAuthorization(data.authorization);
                                      setPurposeCode("");
                                      toast.success("Password setup authorized for five minutes.");
                                    } else {
                                      await API.post("/user/password-history/send");
                                      setPasswordAuthorization("");
                                      toast.success("Check your email for a verification code.");
                                    }
                                  } catch (error) {
                                    setPasswordErrorMsg(formatErrorMessage(error));
                                  } finally {
                                    setPasswordBusy(false);
                                  }
                                }}
                              >
                                {passwordAuthorization
                                  ? "Request new authorization"
                                  : purposeCode
                                    ? "Verify code"
                                    : "Send verification code"}
                              </Button>
                            </div>
                          )}

                          <Input
                            label="New Password"
                            autoComplete="new-password"
                            minLength={8}
                            type="password"
                            required
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="At least 8 characters"
                            disabled={passwordBusy}
                          />
                          <PasswordStrength password={newPassword} />
                          <Input
                            label="Confirm Password"
                            autoComplete="new-password"
                            validationMessage={confirmPassword !== newPassword ? "Enter the same password again." : undefined}
                            type="password"
                            required
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Re-enter password"
                            disabled={passwordBusy}
                          />

                          <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            isLoading={passwordBusy}
                            disabled={
                              !passwordHistoryQuery.data?.acceptingChanges ||
                              (passwordHistoryQuery.data.enabled && !passwordAuthorization)
                            }
                          >
                            Set password
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-6">
                    <div>
                      <h2 className="text-primary section-title">
                        Change password
                      </h2>
                      <p className="text-xs text-secondary mt-0.5">
                        Update your password to keep your financial workspace
                        secure.
                      </p>
                    </div>


                    {passwordErrorMsg && (
                      <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                        <span>{passwordErrorMsg}</span>
                      </div>
                    )}

                    {recoveryQuestionsQuery.data?.enabled||trackedHistoryQuery.data?.stale ? <div className="space-y-3 rounded-xl border border-subtle bg-elevated p-4">
                      <p className="text-sm text-secondary">{trackedHistoryQuery.data?.stale?"Your password history needs verification. Complete identity verification before changing your password. All known password history will be retained.":"Your recovery questions are enabled. Complete identity verification (email code, any enrolled authenticator, and your three security questions) before choosing a new password."}</p>
                      <Button to="/password/reset" variant="outline" size="sm">Verify identity to change password</Button>
                    </div> : <form
                      onSubmit={handlePasswordSubmit}
                      className="space-y-4 max-w-md"
                    >
                      {passwordHistoryQuery.data?.enabled&&<div className="space-y-3 rounded-xl border border-subtle p-4">
                        <p className="text-xs text-secondary">Verify a fresh email code to authorize this password change. Your current and up to three previously tracked passwords cannot be reused.</p>
                        {!passwordAuthorization&&<Input label="Password-change code" inputMode="numeric" autoComplete="one-time-code" value={purposeCode} onChange={e=>setPurposeCode(e.target.value)} disabled={passwordBusy}/>}
                        <Button type="button" variant="outline" size="sm" disabled={passwordBusy} onClick={async()=>{
                          setPasswordBusy(true);setPasswordErrorMsg("");
                          try{
                            if(purposeCode&&!passwordAuthorization){const {data}=await API.post<{authorization:string}>("/user/password-history/confirm",{code:purposeCode});setPasswordAuthorization(data.authorization);setPurposeCode("");toast.success("Password change authorized for five minutes.");}
                            else{await API.post("/user/password-history/send");setPasswordAuthorization("");toast.success("Check your email for a password-change code.");}
                          }catch(error){setPasswordErrorMsg(formatErrorMessage(error));}finally{setPasswordBusy(false);}
                        }}>{passwordAuthorization?"Request new authorization":purposeCode?"Verify password-change code":"Send password-change code"}</Button>
                      </div>}
                      {passwordHistoryQuery.isError&&<p role="alert" className="text-xs text-secondary">Could not check password verification. Reload before changing your password.</p>}
                      {passwordHistoryQuery.data&&!passwordHistoryQuery.data.acceptingChanges&&<div className="space-y-2">
                        <p role="status" className="text-xs text-secondary">Password changes are temporarily paused. Verified recovery remains available to resolve unfinished changes.</p>
                        <Button to="/password/reset" variant="outline" size="sm">Resolve an unfinished change</Button>
                      </div>}
                      <Input
                        label="Current Password"
                        autoComplete="current-password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                        disabled={passwordBusy}
                      />
                      <Input
                        label="New Password"
                        autoComplete="new-password"
                        validationMessage={assessPassword(newPassword).error ?? undefined}
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        minLength={8}
                        disabled={passwordBusy}
                        required
                      />
                      <PasswordStrength password={newPassword} />

                      <Input
                        label="Confirm New Password"
                        autoComplete="new-password"
                        validationMessage={confirmPassword !== newPassword ? "Enter the same password again." : undefined}
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        disabled={passwordBusy}
                        required
                      />
                      {passwordCodeRequired && <>
                        <Input label="Email verification code" autoComplete="one-time-code" inputMode="numeric"
                          pattern="[0-9]+" value={passwordCode} onChange={e => setPasswordCode(e.target.value)}
                          required disabled={passwordBusy} />
                        <Button type="button" variant="outline" size="sm" disabled={passwordBusy} onClick={async () => {
                          setPasswordBusy(true);
                          setPasswordErrorMsg("");
                          try { await sendPasswordCode(); }
                          catch (err) { setPasswordErrorMsg(formatErrorMessage(err)); }
                          finally { setPasswordBusy(false); }
                        }}>Resend verification code</Button>
                      </>}

                      <div className="pt-2">
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          isLoading={passwordBusy}
                          disabled={!passwordHistoryQuery.data?.acceptingChanges||(passwordHistoryQuery.data.enabled&&!passwordAuthorization)}
                        >
                          Update Password
                        </Button>
                      </div>
                    </form>}
                  </div>
                )}

                {/* Session Sign Out */}
                <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-heading font-medium text-primary">
                      Active Session Management
                    </h3>
                    <p className="text-xs text-secondary mt-0.5">
                      Sign out on this device or everywhere you’re signed in.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={signOutMutation.isPending}
                      onClick={() => signOutMutation.mutate("local")}
                      icon={<LogOut className="w-3.5 h-3.5 text-secondary" />}
                    >
                      Sign out on this device
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={signOutMutation.isPending}
                      onClick={() => signOutMutation.mutate("global")}
                    >
                      Sign out all sessions
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: NOTIFICATIONS */}
            {activeTab === "notifications" && (
              <div className="space-y-6">
                <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-6">
                  <div>
                    <h2 className="text-primary section-title">
                      Notification Preferences
                    </h2>
                    <p className="text-xs text-secondary mt-0.5">
                      Choose which events trigger email alerts and in-app
                      updates.
                    </p>
                  </div>


                  {notifErrorMsg && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                      <span>{notifErrorMsg}</span>
                    </div>
                  )}

                  <div className="space-y-4">
                    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-subtle bg-elevated p-4">
                      <span>
                        <span className="block text-sm font-medium text-primary">Notification Sounds</span>
                        <span className="mt-1 block text-xs text-secondary">Play subtle sounds when important actions succeed or fail.</span>
                      </span>
                      <input type="checkbox" defaultChecked={notificationSoundsEnabled()} className="size-5 shrink-0 appearance-auto! accent-primary"
                        onChange={event => setNotificationSounds(event.currentTarget.checked)} />
                    </label>
                    {/* Approvals Category */}
                    <div className="p-4 rounded-xl bg-elevated border border-subtle space-y-3">
                      <div className="font-heading font-medium text-sm text-primary">
                        Financial Approvals &amp; Liquidations
                      </div>
                      <p className="text-xs text-secondary">
                        Updates when expenses are submitted, approved, rejected,
                        or when cash advance liquidations are reviewed.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-4 pt-1">
                        <label className="flex items-center gap-2.5 text-xs text-secondary hover:text-primary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifications.email_approvals}
                            onChange={() =>
                              handleNotificationToggle("email_approvals")
                            }
                            className="w-4 h-4 rounded bg-surface border-subtle text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                          <span>Email Notifications</span>
                        </label>
                        <label className="flex items-center gap-2.5 text-xs text-secondary hover:text-primary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifications.in_app_approvals}
                            onChange={() =>
                              handleNotificationToggle("in_app_approvals")
                            }
                            className="w-4 h-4 rounded bg-surface border-subtle text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                          <span>In-App Banner Alerts</span>
                        </label>
                      </div>
                    </div>

                    {/* Dues & Payments */}
                    <div className="p-4 rounded-xl bg-elevated border border-subtle space-y-3">
                      <div className="font-heading font-medium text-sm text-primary">
                        Dues Assessments &amp; Official Receipts
                      </div>
                      <p className="text-xs text-secondary">
                        Alerts when new membership obligations are assessed,
                        payments are recorded, or electronic receipts are
                        generated.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-4 pt-1">
                        <label className="flex items-center gap-2.5 text-xs text-secondary hover:text-primary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifications.email_payments}
                            onChange={() =>
                              handleNotificationToggle("email_payments")
                            }
                            className="w-4 h-4 rounded bg-surface border-subtle text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                          <span>Email Receipts &amp; Dues Notices</span>
                        </label>
                        <label className="flex items-center gap-2.5 text-xs text-secondary hover:text-primary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifications.in_app_payments}
                            onChange={() =>
                              handleNotificationToggle("in_app_payments")
                            }
                            className="w-4 h-4 rounded bg-surface border-subtle text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                          <span>In-App Payment Alerts</span>
                        </label>
                      </div>
                    </div>

                    {/* Invitations & Roles */}
                    <div className="p-4 rounded-xl bg-elevated border border-subtle space-y-3">
                      <div className="font-heading font-medium text-sm text-primary">
                        Organization Invitations &amp; Role Updates
                      </div>
                      <p className="text-xs text-secondary">
                        Notifications when you are invited to join an
                        organization or when your officer permissions change.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-4 pt-1">
                        <label className="flex items-center gap-2.5 text-xs text-secondary hover:text-primary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifications.email_invites}
                            onChange={() =>
                              handleNotificationToggle("email_invites")
                            }
                            className="w-4 h-4 rounded bg-surface border-subtle text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                          <span>Email Invitation Alerts</span>
                        </label>
                        <label className="flex items-center gap-2.5 text-xs text-secondary hover:text-primary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifications.in_app_invites}
                            onChange={() =>
                              handleNotificationToggle("in_app_invites")
                            }
                            className="w-4 h-4 rounded bg-surface border-subtle text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                          <span>In-App Role Updates</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-elevated border border-subtle flex items-start gap-2.5 text-xs text-secondary">
                    <Info className="w-4 h-4 text-muted shrink-0 mt-0.5" />
                    <span>
                      Critical security communications (such as password
                      recovery codes and account deletion confirmations) are
                      mandatory and cannot be disabled.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: APPEARANCE & PREFERENCES */}
            {activeTab === "appearance" && (
              <div className="space-y-6">
                <form onSubmit={handlePreferencesSubmit} className="space-y-6">
                  <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-6">
                    <div>
                      <h2 className="text-primary section-title">
                        Appearance &amp; Accessibility
                      </h2>
                      <p className="text-xs text-secondary mt-0.5">
                        Customize how Bantai renders across your desktop and
                        mobile devices.
                      </p>
                    </div>


                    {prefsErrorMsg && (
                      <div className="p-3 rounded-xl bg-sem-error-bg border border-sem-error-border text-xs text-sem-error-fg flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{prefsErrorMsg}</span>
                      </div>
                    )}

                    <div className="space-y-3">
                      <p className="text-xs font-medium text-primary">Theme mode</p>
                      <ThemeChoices value={theme} onChange={setThemeInput}
                        disabled={updatePreferencesMutation.isPending} />
                    </div>

                    {/* Reduced Motion Toggle */}
                    <div className="p-4 rounded-xl bg-secondary-surface border border-subtle flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium text-primary">
                          Reduced Motion
                        </div>
                        <p className="text-[11px] text-secondary mt-0.5">
                          Minimize subtle animations, transitions, and scroll
                          effects throughout the platform.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={reducedMotion}
                          onChange={(e) =>
                            setReducedMotionInput(e.target.checked)
                          }
                          className="sr-only peer"
                        />
                        <div className="w-10 h-5 bg-surface border border-subtle peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-secondary peer-checked:after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:border-emerald-500"></div>
                      </label>
                    </div>

                    {/* Default Organization */}
                    <div className="space-y-2">
                      <Select
                        label="Default Organization Workspace"
                        value={defaultOrgId ?? ""}
                        onChange={(e) =>
                          setDefaultOrgInput(e.target.value || null)
                        }
                        placeholder="None (Always show Personal Workspace Dashboard)"
                        options={[
                          {
                            value: "",
                            label:
                              "None (Always show Personal Workspace Dashboard)",
                          },
                          ...memberships.map((m) => ({
                            value: m.organization_id,
                            label: `${m.organizations?.name || "Organization"} (${m.role})`,
                          })),
                        ]}
                      />
                      <p className="text-[11px] text-muted font-mono">
                        Choose which workspace opens directly when you log into
                        Bantai.
                      </p>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        isLoading={updatePreferencesMutation.isPending}
                      >
                        Save Preferences
                      </Button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* TAB 5: ACCOUNT & MEMBERSHIPS (DANGER ZONE) */}
            {activeTab === "management" && (
              <div className="space-y-6">
                {/* Active Memberships */}
                <div className="p-6 rounded-2xl bg-surface border border-subtle shadow-xs dark:shadow-none space-y-4">
                  <div>
                    <h2 className="text-primary section-title">
                      Your Organization Memberships
                    </h2>
                    <p className="text-xs text-secondary mt-0.5">
                      Organizations you currently belong to with role
                      privileges.
                    </p>
                  </div>

                  {memberships.length === 0 ? (
                    <div className="p-8 rounded-xl border border-subtle text-center text-xs text-muted">
                      You are not currently a member of any organizations.
                    </div>
                  ) : (
                    <div className="divide-y divide-subtle border border-subtle rounded-xl overflow-hidden">
                      {memberships.map((m) => {
                        const isSoleOwner =
                          m.role === "owner" && soleOwnerOrgs.length > 0;
                        const orgData = getOrgCoverAndLogo(
                          m.organization_id,
                          m.organizations?.name || "Organization",
                          m.organizations?.logo_url,
                          m.organizations?.cover_image_url,
                          m.organizations?.cover_theme,
                        );
                        return (
                          <div
                            key={m.organization_id}
                            className="p-4 bg-surface flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-xl bg-elevated border border-subtle flex items-center justify-center text-primary shrink-0 overflow-hidden shadow-sm">
                                {orgData.customLogoUrl ? (
                                  <img
                                    src={orgData.customLogoUrl}
                                    alt={
                                      m.organizations?.name || "Organization"
                                    }
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div
                                    className={`w-full h-full flex items-center justify-center font-semibold text-xs ${orgData.theme.avatarBg}`}
                                  >
                                    {orgData.initials}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-primary truncate flex items-center gap-2">
                                  <span>
                                    {m.organizations?.name || "Organization"}
                                  </span>
                                  <Badge >
                                    {m.role}
                                  </Badge>
                                  {isSoleOwner && (
                                    <Badge >
                                      Sole Owner
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted font-mono">
                                  Currency: {m.organizations?.currency || "PHP"}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                to={`/app/org/${m.organization_id}/overview`}
                                variant="ghost"
                                size="sm"
                                iconRight={
                                  <ExternalLink className="w-3 h-3 text-secondary" />
                                }
                                className="text-xs text-secondary"
                              >
                                Open
                              </Button>

                              {isSoleOwner ? (
                                <Badge title="Sole owners must transfer ownership or delete the organization first.">
                                  Cannot Leave
                                </Badge>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLeaveErrorMsg("");
                                    setLeavingOrg(m);
                                  }}
                                  className="px-3 py-1.5 rounded-xl border border-subtle hover:border-red-500/30 text-xs font-medium text-secondary hover:text-red-600 dark:hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
                                >
                                  Leave
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <section className="rounded-2xl border border-subtle bg-surface p-6 space-y-4">
                  <h2 className="section-title">Deactivation readiness</h2>
                  <div className="p-4 rounded-xl bg-surface border border-subtle space-y-2 text-xs text-secondary">
                    <div className="font-medium text-primary flex items-center gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-secondary shrink-0" />
                      Financial record retention
                    </div>
                    <p className="text-[11px] text-secondary leading-relaxed">
                      To preserve statutory compliance and financial audit
                      integrity, historical records associated with your actions
                      (such as dues collected, expenses submitted, approved
                      liquidations, and audit entries) will remain securely
                      archived in your organizations under an anonymized{" "}
                      <strong className="text-primary">&quot;Former Member&quot;</strong> label. Active
                      memberships and personal settings will be revoked
                      immediately.
                    </p>
                  </div>

                  {organizationsQuery.isPending ? (
                    <p role="status" className="text-xs text-secondary">Checking organization ownership…</p>
                  ) : organizationsQuery.isError ? (
                    <p role="status" className="text-xs text-secondary">
                      Organization ownership could not be verified.{" "}
                      <button type="button" className="cursor-pointer underline" onClick={() => void organizationsQuery.refetch()}>
                        Try again
                      </button>
                    </p>
                  ) : soleOwnerOrgs.length > 0 ? (
                    <div className="p-3.5 rounded-xl bg-surface border border-sem-error-border text-xs text-primary flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-sem-error-fg shrink-0 mt-0.5" />
                      <span>
                        Transfer ownership or close each workspace you own in Organization Settings before deactivating your account.
                      </span>
                    </div>
                  ) : null}

                </section>

                <section className="flex flex-col gap-4 rounded-2xl border border-sem-error-border bg-sem-error-bg p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="section-title flex items-center gap-2">
                      <AlertTriangle className="size-5 shrink-0 text-sem-error-fg" aria-hidden="true" />
                      Deactivate account
                    </h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-secondary">
                      Permanently deactivate your Bantai account and anonymize your personal credentials.
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDeleteErrorMsg("");
                        setDeleteConfirmationText("");
                        setShowDeleteModal(true);
                      }}
                      disabled={!organizationsQuery.isSuccess || soleOwnerOrgs.length > 0}
                    >
                      Deactivate Bantai Account
                    </Button>
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* LEAVE ORGANIZATION MODAL */}
      <Modal
        isOpen={Boolean(leavingOrg)}
        onClose={() => setLeavingOrg(null)}
        maxWidth="md"
      >
        <div className="p-6 space-y-5 font-body">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-heading font-medium text-primary">
                Leave Organization
              </h3>
              <p className="text-xs text-secondary">
                Confirm your departure from {leavingOrg?.organizations?.name}.
              </p>
            </div>
          </div>

          <p className="text-xs text-secondary leading-relaxed">
            You will forfeit all officer and member permissions within this
            workspace. Historical dues and contribution receipts you made will
            remain in the organization ledger for audit purposes.
          </p>

          {leaveErrorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300">
              {leaveErrorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLeavingOrg(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={leaveOrgMutation.isPending}
              onClick={() => {
                if (leavingOrg) {
                  leaveOrgMutation.mutate(leavingOrg.organization_id);
                }
              }}
            >
              Confirm &amp; Leave
            </Button>
          </div>
        </div>
      </Modal>

      {/* DELETE ACCOUNT CONFIRMATION MODAL */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        maxWidth="md"
      >
        <div className="p-6 space-y-5 font-body">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-heading font-medium text-primary">
                Confirm Account Deactivation
              </h3>
              <p className="text-xs text-secondary">
                This action is permanent and cannot be reversed.
              </p>
            </div>
          </div>

          <p className="text-xs text-secondary leading-relaxed">
            Your personal profile will be anonymized to &quot;Former
            Member&quot; and your login credentials will be revoked. To confirm,
            please type{" "}
            <strong className="text-primary font-mono">DELETE MY ACCOUNT</strong>{" "}
            below:
          </p>

          <Input
            type="text"
            value={deleteConfirmationText}
            onChange={(e) => setDeleteConfirmationText(e.target.value)}
            placeholder="DELETE MY ACCOUNT"
            className="font-mono text-xs"
          />

          {deleteErrorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300">
              {deleteErrorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={deleteAccountMutation.isPending}
              disabled={deleteConfirmationText !== "DELETE MY ACCOUNT"}
              onClick={() => deleteAccountMutation.mutate()}
            >
              Permanently Deactivate Account
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
