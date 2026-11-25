import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FloatingMenu from "../ui/FloatingMenu";
import { toast as sonner } from "sonner";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  Clock,
  CreditCard,
  FileCheck,
  Receipt,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  X,
} from "lucide-react";
import useAuth from "../../hooks/useAuth";
import {
  getNotifications,
  getPendingWorkspaceInvitations,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  respondToWorkspaceInvitation,
  type NotificationItem,
} from "../../lib/api";
import { playNotificationSound } from "../../lib/notificationSound";
import { toast } from "../../lib/toast";
import { navigateWithTransition } from "../../utils/navTransition";

interface NotificationBellProps {
  organizationId?: string;
}

const PAGE_SIZE = 15;

function formatRelativeTime(iso: string): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSeconds < 60) return "Just now";
  const mins = Math.floor(diffSeconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function getNotificationVisual(type: string) {
  if (type === "platform.incident_opened" || type === "platform.account_locked") {
    return { Icon: ShieldAlert, tone: "text-sem-warning-fg bg-sem-warning-bg border-sem-warning-border" };
  }
  if (type === "expense.submitted") {
    return { Icon: Receipt, tone: "text-sem-warning-fg bg-sem-warning-bg border-sem-warning-border" };
  }
  if (type === "expense.approved" || type === "cash_advance.approved" || type === "cash_advance.released") {
    return { Icon: Check, tone: "text-sem-success-fg bg-sem-success-bg border-sem-success-border" };
  }
  if (type === "expense.rejected" || type === "cash_advance.rejected" || type === "payment.reversed") {
    return { Icon: X, tone: "text-sem-error-fg bg-sem-error-bg border-sem-error-border" };
  }
  if (type === "cash_advance.submitted") {
    return { Icon: FileCheck, tone: "text-sem-warning-fg bg-sem-warning-bg border-sem-warning-border" };
  }
  if (type === "payment.due_reminder") {
    return { Icon: Clock, tone: "text-sem-warning-fg bg-sem-warning-bg border-sem-warning-border" };
  }
  if (type.startsWith("payment.") || type.startsWith("collection.")) {
    return { Icon: CreditCard, tone: "text-sem-info-fg bg-sem-info-bg border-sem-info-border" };
  }
  if (type === "member.role_updated") {
    return { Icon: ShieldCheck, tone: "text-primary bg-secondary-surface border-subtle" };
  }
  if (type === "organization.invitation_created") {
    return { Icon: UserPlus, tone: "text-sem-success-fg bg-sem-success-bg border-sem-success-border" };
  }
  return { Icon: Bell, tone: "text-secondary bg-secondary-surface border-subtle" };
}

function resolveNotificationRoute(item: NotificationItem): string | null {
  if (item.type === "platform.incident_opened") return "/admin?section=incidents";
  if (item.type === "platform.account_locked") return "/admin?section=threats";
  const orgId =
    item.organization_id ??
    (typeof item.metadata?.organization_id === "string" ? item.metadata.organization_id : null);

  if (item.type === "expense.submitted" || item.type === "cash_advance.submitted") {
    return orgId ? `/app/org/${orgId}/approvals` : null;
  }
  if (item.type === "expense.approved" || item.type === "expense.rejected") {
    return orgId ? `/app/org/${orgId}/expenses` : null;
  }
  if (
    item.type === "cash_advance.approved" ||
    item.type === "cash_advance.rejected" ||
    item.type === "cash_advance.released"
  ) {
    return orgId ? `/app/org/${orgId}/liquidation` : null;
  }
  if (
    item.type === "collection.assigned" ||
    item.type === "payment.recorded" ||
    item.type === "payment.reversed" ||
    item.type === "payment.due_reminder"
  ) {
    return orgId ? `/app/org/${orgId}/contributions` : "/app/payments";
  }
  if (item.type === "member.role_updated") {
    return orgId ? `/app/org/${orgId}/members` : null;
  }
  return null;
}

export default function NotificationBell({ organizationId }: NotificationBellProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const bellRef = useRef<HTMLButtonElement>(null);
  const latestSeen = useRef<{ userId: string; createdAt: number; ids: Set<string> } | null>(null);
  const activeToasts = useRef(new Set<string>());
  const [isOpen, setIsOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [scopeToWorkspace, setScopeToWorkspace] = useState(false);

  const activeOrgFilter = scopeToWorkspace && organizationId ? organizationId : undefined;

  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread-count", user?.id, activeOrgFilter ?? "all"],
    queryFn: ({ signal }) => getUnreadNotificationCount(activeOrgFilter, signal),
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
  });

  const invitationsQuery = useQuery({
    queryKey: ["notifications", "pending-invitations", user?.id],
    queryFn: ({ signal }) => getPendingWorkspaceInvitations(signal),
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
  });
  const listQuery = useInfiniteQuery({
    queryKey: ["notifications", "list", user?.id, activeOrgFilter ?? "all", unreadOnly],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      getNotifications({ limit: PAGE_SIZE, offset: pageParam, unreadOnly, organizationId: activeOrgFilter }, signal),
    getNextPageParam: page => page.hasMore && page.offset + page.limit <= 10_000 ? page.offset + page.limit : undefined,
    enabled: Boolean(user?.id) && isOpen,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
  });

  const latestQuery = useQuery({
    queryKey: ["notifications", "latest", user?.id],
    queryFn: ({ signal }) => getNotifications({ limit: PAGE_SIZE, offset: 0 }, signal),
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => toast.error("Couldn’t mark the notification as read."),
  });

  const markAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(activeOrgFilter),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("All notifications marked as read.");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Unable to mark notifications as read.");
    },
  });

  const inviteRespondMutation = useMutation({
    mutationFn: ({ invitationId, accept }: { invitationId: string; accept: boolean }) =>
      respondToWorkspaceInvitation(invitationId, accept).then(response => ({ ...response, accept })),
    onSuccess: ({ invitation, accept }) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof getPendingWorkspaceInvitations>>>(
        ["notifications", "pending-invitations", user?.id],
        current => current && ({ invitations: current.invitations.filter(item => item.id !== invitation.id) }),
      );
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(accept ? "Invitation accepted." : "Invitation declined.");
      if (accept) {
        setIsOpen(false);
        navigateWithTransition(() => navigate(`/app/org/${invitation.organization_id}/overview`));
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Unable to respond to invitation.");
      void invitationsQuery.refetch();
    },
  });

  const pending = invitationsQuery.data?.invitations;
  const items = useMemo(() => {
    const pendingIds = new Set(pending?.map(invitation => invitation.id));
    const itemsById = new Map<string, NotificationItem>();
    for (const page of listQuery.data?.pages ?? []) {
      for (const item of page.items) {
        if (item.type === "organization.invitation_created" && item.entity_id && pendingIds.has(item.entity_id)) continue;
        if (!itemsById.has(item.id)) itemsById.set(item.id, item);
      }
    }
    return [...itemsById.values()];
  }, [listQuery.data?.pages, pending]);

  const unreadCount = unreadQuery.data?.unreadCount ?? 0;
  const pendingCount = pending?.length ?? 0;
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["notifications"] }); };

  const { mutate: markRead } = markReadMutation;
  const handleItemClick = useCallback((item: NotificationItem, openInbox = false) => {
    if (!item.read_at) markRead(item.id);
    const targetRoute = resolveNotificationRoute(item);
    if (targetRoute) {
      setIsOpen(false);
      navigateWithTransition(() => navigate(targetRoute));
    } else if (openInbox) {
      const visibleBell = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-notification-bell]"))
        .find(bell => bell.getClientRects().length > 0);
      visibleBell?.dispatchEvent(new Event("bantai-open-inbox"));
    }
  }, [markRead, navigate]);

  useEffect(() => {
    const bell = bellRef.current;
    if (!bell) return;
    const openInbox = () => {
      setScopeToWorkspace(false);
      setUnreadOnly(false);
      setIsOpen(true);
    };
    bell.addEventListener("bantai-open-inbox", openInbox);
    return () => bell.removeEventListener("bantai-open-inbox", openInbox);
  }, [user?.id]);

  useEffect(() => {
    const ids = activeToasts.current;
    return () => {
      for (const id of ids) sonner.dismiss(id);
      ids.clear();
    };
  }, [user?.id]);

  useEffect(() => {
    const userId = user?.id;
    const items = latestQuery.data?.items;
    if (!userId || !latestQuery.isFetchedAfterMount || !items) return;

    const previous = latestSeen.current?.userId === userId ? latestSeen.current : null;
    const createdAt = Math.max(previous?.createdAt ?? -Infinity, ...items.map(item => Date.parse(item.created_at)));
    const ids = new Set(createdAt === previous?.createdAt ? previous.ids : []);
    for (const item of items) {
      if (Date.parse(item.created_at) === createdAt) ids.add(item.id);
    }
    latestSeen.current = { userId, createdAt, ids };

    if (!previous || !bellRef.current?.getClientRects().length) return;
    const arrivals = items.filter(item => {
      const timestamp = Date.parse(item.created_at);
      return !item.read_at && (timestamp > previous.createdAt ||
        (timestamp === previous.createdAt && !previous.ids.has(item.id)));
    });
    if (arrivals.length) playNotificationSound("success");

    for (const item of arrivals.reverse()) {
      const id = `notification:${item.id}`;
      const { Icon, tone } = getNotificationVisual(item.type);
      const active = activeToasts.current;
      const forget = () => { active.delete(id); };
      const dismiss = () => {
        sonner.dismiss(id);
        forget();
      };
      active.add(id);
      sonner.custom(() => (
        <div className="flex w-full flex-col gap-3.5 p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border ${tone}`}>
              <Icon size={13} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 break-words">
              <p className="text-[13px] font-medium leading-snug text-primary">{item.title}</p>
              {item.message && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-secondary">{item.message}</p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex h-8 cursor-pointer items-center rounded-lg px-2.5 text-xs font-medium text-secondary transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-2 focus-visible:outline-border-strong"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                dismiss();
                handleItemClick(item, true);
              }}
              className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-action px-3.5 text-xs font-medium text-action-fg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-border-strong"
            >
              View
            </button>
          </div>
        </div>
      ), {
        id,
        position: "top-right",
        duration: 8000,
        closeButton: false,
        className: "bantai-inbox-toast",
        onDismiss: forget,
        onAutoClose: forget,
      });
    }
  }, [handleItemClick, latestQuery.data, latestQuery.isFetchedAfterMount, user?.id]);

  if (!user) return null;

  return (
    <div className="relative">
      <button
        ref={bellRef}
        data-notification-bell
        type="button"
        onClick={() => {
          if (!isOpen) refresh();
          setIsOpen(!isOpen);
        }}
        aria-label={`Notifications${pendingCount ? `, ${pendingCount} pending invitations` : ""}`}
        aria-expanded={isOpen}
        className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-subtle bg-elevated text-secondary transition-colors hover:border-strong hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-strong"
      >
        <Bell className="size-4" aria-hidden="true" />
        {pendingCount > 0 && unreadCount === 0 && (
          <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-action ring-2 ring-canvas" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-action px-1 text-[10px] font-bold leading-none text-action-fg shadow-sm ring-2 ring-canvas">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <FloatingMenu
        open={isOpen}
        onClose={() => setIsOpen(false)}
        align="right"
        mobileSpacing
        role="dialog"
        aria-label="Notifications"
        className="w-[340px] sm:w-[390px] overflow-hidden rounded-2xl border border-subtle bg-surface shadow-2xl backdrop-blur-xl"
      >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-primary">Notifications</h2>
              {unreadCount > 0 && (
                <span className="rounded-full bg-elevated border border-subtle px-2 py-0.5 text-[11px] font-medium text-secondary">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-secondary transition-colors hover:bg-elevated hover:text-primary disabled:opacity-50"
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Filter Bar */}
          <div className="flex items-center justify-between border-b border-subtle px-4 py-2 text-xs">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setUnreadOnly(false)}
                className={`cursor-pointer rounded-md px-2.5 py-1 font-medium transition-colors ${
                  !unreadOnly ? "bg-elevated text-primary" : "text-secondary hover:text-primary"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setUnreadOnly(true)}
                className={`cursor-pointer rounded-md px-2.5 py-1 font-medium transition-colors ${
                  unreadOnly ? "bg-elevated text-primary" : "text-secondary hover:text-primary"
                }`}
              >
                Unread
              </button>
            </div>

            {organizationId && (
              <button
                type="button"
                onClick={() => setScopeToWorkspace((prev) => !prev)}
                className={`cursor-pointer rounded-md px-2 py-1 font-medium transition-colors ${
                  scopeToWorkspace
                    ? "bg-elevated text-primary"
                    : "text-secondary hover:text-primary"
                }`}
              >
                {scopeToWorkspace ? "This workspace" : "All workspaces"}
              </button>
            )}
          </div>

          {(listQuery.isError || unreadQuery.isError || invitationsQuery.isError) && (
            <div role="alert" className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-2 text-xs">
              <p>{listQuery.isError ? "Couldn’t load notifications." : invitationsQuery.isError
                ? "Couldn’t load pending invitations." : "Couldn’t refresh the unread count."}</p>
              <button type="button" onClick={refresh} className="rounded px-2 py-1 font-semibold hover:bg-hover-surface">Retry</button>
            </div>
          )}
          {/* Notification List */}
          <div className="max-h-[400px] overflow-y-auto [&>*+*]:border-t [&>*+*]:border-subtle">
            {pendingCount > 0 && <section aria-label="Pending invitations" className="space-y-3 p-4">
              <h3 className="text-xs font-semibold">Pending invitations</h3>
              {pending?.map(invitation => (
                <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-medium">{invitation.organization_name}</p>
                  <div role="group" aria-label={`Invitation to ${invitation.organization_name}`} className="flex gap-2 text-xs">
                    <button type="button" disabled={inviteRespondMutation.isPending}
                      onClick={() => inviteRespondMutation.mutate({ invitationId: invitation.id, accept: true })}
                      className="rounded-lg bg-action px-3 py-2 font-semibold text-action-fg disabled:opacity-50">Accept</button>
                    <button type="button" disabled={inviteRespondMutation.isPending}
                      onClick={() => inviteRespondMutation.mutate({ invitationId: invitation.id, accept: false })}
                      className="rounded-lg border border-subtle px-3 py-2 disabled:opacity-50">Decline</button>
                  </div>
                </div>
              ))}
            </section>}
            {listQuery.isLoading ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className="flex animate-pulse gap-3">
                    <div className="h-8 w-8 shrink-0 rounded-lg bg-skeleton" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 rounded bg-skeleton" />
                      <div className="h-3 w-full rounded bg-skeleton" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 && listQuery.isSuccess ? (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-subtle bg-secondary-surface text-muted">
                  <Bell className="size-4" />
                </div>
                <p className="text-sm font-medium text-primary">
                  {pendingCount ? "No other notifications" : unreadOnly ? "You're all caught up" : "No notifications yet"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {unreadOnly
                    ? "No unread alerts in this view."
                    : "Approvals, payment updates, and invitations will appear here."}
                </p>
              </div>
            ) : (
              items.map((item) => {
                const { Icon, tone } = getNotificationVisual(item.type);
                const isUnread = !item.read_at;
                const targetRoute = resolveNotificationRoute(item);

                return (
                  <div
                    key={item.id}
                    className={`group flex items-start gap-1 px-2 py-1.5 transition-colors ${
                      isUnread
                        ? "bg-secondary-surface/80 hover:bg-hover-surface dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                        : "hover:bg-hover-surface/80 dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleItemClick(item)}
                      className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-xl px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-strong"
                    >
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${tone}`}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-primary group-hover:text-primary">
                            {item.title}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
                            {formatRelativeTime(item.created_at)}
                            {targetRoute && (
                              <ArrowUpRight
                                className="size-3 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                                aria-hidden="true"
                              />
                            )}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-secondary">
                          {item.message}
                        </p>
                      </div>
                    </button>

                    {isUnread && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          markRead(item.id);
                        }}
                        title="Mark as read"
                        aria-label="Mark notification as read"
                        className="mt-2 grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-strong"
                      >
                        <span className="size-2 rounded-full bg-action group-hover:hidden" aria-hidden="true" />
                        <Check className="hidden size-3.5 group-hover:block" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer / Pagination */}
          {listQuery.hasNextPage && (
            <div className="border-t border-subtle p-2 text-center">
              <button
                type="button"
                onClick={() => void listQuery.fetchNextPage()}
                disabled={listQuery.isFetching}
                className="w-full rounded-lg py-1.5 text-xs font-medium text-secondary transition hover:bg-hover-surface hover:text-primary disabled:opacity-50"
              >
                {listQuery.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
      </FloatingMenu>
    </div>
  );
}
