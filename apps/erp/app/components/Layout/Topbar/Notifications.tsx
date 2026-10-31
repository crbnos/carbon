// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";
import { NotificationEvent, renderInlineLinks } from "@carbon/notifications";
import { useLoaderQuery } from "@carbon/query";
import {
  Badge,
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useRouteData
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuBell,
  LuCalendarClock,
  LuCalendarX,
  LuChevronDown,
  LuChevronUp,
  LuCircleGauge,
  LuCirclePlay,
  LuClipboardCheck,
  LuDollarSign,
  LuFileSpreadsheet,
  LuGitPullRequestArrow,
  LuGraduationCap,
  LuHammer,
  LuInbox,
  LuLightbulb,
  LuListChecks,
  LuLoader,
  LuMailCheck,
  LuMessageSquare,
  LuPackageSearch,
  LuRefreshCw,
  LuShieldAlert,
  LuShieldX,
  LuShoppingCart,
  LuWrench
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { Link, useNavigate } from "react-router";
import { DateTime } from "~/components";
import { useNotifications, useUser } from "~/hooks";
import { useAppBadge } from "~/hooks/useAppBadge";
import { useRestoreBrowserNotifications } from "~/hooks/usePushSubscription";
import { usePeople } from "~/stores";
import type { Notification as NotificationRecord } from "~/types";
import {
  type NotificationDocumentType,
  notificationTarget
} from "~/utils/notification-target";
import { path } from "~/utils/path";
import { EnableBrowserNotifications } from "./EnableBrowserNotifications";

type OutstandingTraining = {
  trainingAssignmentId: string;
  trainingId: string;
  trainingName: string;
  frequency: string;
  trainingType: string;
  status: "Pending" | "Overdue";
  currentPeriod: string | null;
};

// `payload.details` is written by the notify job but is not on the topbar
// Notification type, which only declares the keys this menu always reads.
function getNotificationBody(
  payload: NotificationRecord["payload"],
  event: NotificationEvent
): string | undefined {
  // Workflow is the only event whose body is authored text rather than a
  // restatement of the description — every other event would render twice.
  if (event !== NotificationEvent.Workflow) return undefined;
  const details = (payload as { details?: { label: string; value: string }[] })
    .details;
  if (!Array.isArray(details)) return undefined;
  const message = details.find((detail) => detail?.label === "Message")?.value;
  return typeof message === "string" && message.length > 0
    ? message
    : undefined;
}

function EmptyState({ description }: { description: string }) {
  return (
    <div className="h-[460px] max-md:h-auto max-md:py-16 flex items-center justify-center flex-col gap-y-4">
      <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
        <LuInbox size={18} />
      </div>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

function TrainingItem({
  training,
  onClose
}: {
  training: OutstandingTraining;
  onClose: () => void;
}) {
  return (
    <Link
      className="flex items-center gap-x-4 px-3 py-3 hover:bg-secondary"
      onClick={() => onClose()}
      to={path.to.completeTrainingAssignment(training.trainingAssignmentId)}
    >
      <div>
        <div className="h-9 w-9 flex items-center justify-center border rounded-full">
          <LuGraduationCap size={16} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex w-full justify-between items-center gap-2">
          <div className="flex flex-col gap-y-1">
            <p className="text-sm truncate">{training.trainingName}</p>
            <div className="flex items-center gap-x-2">
              <span className="text-xs text-muted-foreground capitalize">
                {training.frequency}
              </span>
            </div>
          </div>
          <Badge
            variant={
              training.status === "Overdue" ? "destructive" : "secondary"
            }
            className="text-xs"
          >
            {training.status}
          </Badge>
        </div>
      </div>
    </Link>
  );
}

function Notification({
  icon,
  to,
  reloadDocument,
  description,
  body,
  createdAt,
  markMessageAsRead,
  from,
  onClose
}: {
  icon: React.ReactNode;
  to: string;
  // A resource route (a file download) needs a full page request, not a
  // client navigation.
  reloadDocument?: boolean;
  description: string;
  body?: string;
  createdAt: string;
  from?: string;
  markMessageAsRead?: () => void;
  onClose: () => void;
}) {
  const { id: userId } = useUser();
  const { t } = useLingui();
  const [people] = usePeople();
  const navigate = useNavigate();
  let byUser = "";
  if (from) {
    if (from === userId) {
      byUser = t`yourself`;
    } else {
      byUser = people.find((p) => p.id === from)?.name ?? "";
    }
  }

  const segments = body
    ? renderInlineLinks(
        body,
        typeof window === "undefined" ? "" : window.location.origin
      )
    : null;

  const content = (
    <>
      <div>
        <div className="h-9 w-9 flex items-center justify-center gap-y-0 border rounded-full">
          {icon}
        </div>
      </div>
      <div>
        <p className="text-sm">
          {description} {byUser && <span>{t`by ${byUser}`}</span>}
        </p>
        {segments && segments.length > 0 && (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {segments.map((segment, index) =>
              "href" in segment ? (
                <a
                  key={`${index}:${segment.text}`}
                  href={segment.href}
                  className="underline underline-offset-2 hover:text-foreground"
                  // `/api/link` switches the active company server-side before
                  // redirecting, so this must be a full page load.
                  onClick={(e) => e.stopPropagation()}
                >
                  {segment.text}
                </a>
              ) : (
                <span key={`${index}:${segment.text}`}>{segment.text}</span>
              )
            )}
          </p>
        )}
        <span className="text-xs text-muted-foreground">
          <DateTime value={createdAt} variant="relative" />
        </span>
      </div>
    </>
  );

  return (
    <div className="flex items-between justify-between gap-x-4 px-3 py-3 hover:bg-secondary">
      {segments ? (
        // A body can contain anchors, and an <a> inside an <a> is invalid HTML —
        // browsers unnest it, which would pull the link out of the row.
        <div
          role="link"
          tabIndex={0}
          className="flex items-between justify-between gap-x-4 cursor-pointer"
          onClick={() => {
            onClose();
            if (reloadDocument) window.location.assign(to);
            else navigate(to);
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            onClose();
            if (reloadDocument) window.location.assign(to);
            else navigate(to);
          }}
        >
          {content}
        </div>
      ) : (
        <Link
          className="flex items-between justify-between gap-x-4 "
          onClick={() => onClose()}
          to={to}
          reloadDocument={reloadDocument}
        >
          {content}
        </Link>
      )}
      {markMessageAsRead && (
        <div>
          <IconButton
            aria-label={t`Mark as read`}
            icon={<LuMailCheck />}
            variant="secondary"
            className="rounded-full before:rounded-full"
            onClick={markMessageAsRead}
          />
        </div>
      )}
    </div>
  );
}

/** The topbar icon of each event. An event without one has no row here
 *  (Digest rows are `DigestNotification`). */
const NOTIFICATION_ICONS: Partial<Record<NotificationEvent, React.ReactNode>> =
  {
    [NotificationEvent.ApprovalApproved]: <LuClipboardCheck />,
    [NotificationEvent.ApprovalRejected]: <LuClipboardCheck />,
    [NotificationEvent.ApprovalRequested]: <LuClipboardCheck />,
    [NotificationEvent.ChangeNoticeStarted]: <LuGitPullRequestArrow />,
    [NotificationEvent.ChangeNoticeImplementation]: <LuGitPullRequestArrow />,
    [NotificationEvent.ChangeNoticeDone]: <LuGitPullRequestArrow />,
    [NotificationEvent.DigitalQuoteResponse]: <LuDollarSign />,
    [NotificationEvent.GaugeCalibrationExpired]: <LuCircleGauge />,
    [NotificationEvent.SalesRuleViolation]: <LuShieldAlert />,
    [NotificationEvent.IntegrationSync]: <LuRefreshCw />,
    [NotificationEvent.TableExport]: <LuFileSpreadsheet />,
    [NotificationEvent.TableBulkAction]: <LuListChecks />,
    [NotificationEvent.RecurringInvoicing]: <LuDollarSign />,
    [NotificationEvent.LeaseCriticalDate]: <LuCalendarClock />,
    [NotificationEvent.JobCompleted]: <LuHammer />,
    [NotificationEvent.JobAssignment]: <LuHammer />,
    [NotificationEvent.JobOperationAssignment]: <LuCirclePlay />,
    [NotificationEvent.JobOperationMessage]: <LuMessageSquare />,
    [NotificationEvent.MaintenanceDispatchCreated]: <LuWrench />,
    [NotificationEvent.MaintenanceDispatchAssignment]: <LuWrench />,
    [NotificationEvent.NonConformanceAssignment]: <LuShieldX />,
    [NotificationEvent.ProcedureAssignment]: <LuListChecks />,
    [NotificationEvent.QuoteExpired]: <LuCalendarX />,
    [NotificationEvent.PurchaseInvoiceAssignment]: <LuShoppingCart />,
    [NotificationEvent.PurchasingRfqAssignment]: <LuPackageSearch />,
    [NotificationEvent.PurchaseOrderAssignment]: <LuShoppingCart />,
    [NotificationEvent.QuoteAssignment]: <RiProgress4Line />,
    [NotificationEvent.RiskAssignment]: <LuShieldAlert />,
    [NotificationEvent.SalesRfqReady]: <RiProgress2Line />,
    [NotificationEvent.SalesRfqAssignment]: <RiProgress2Line />,
    [NotificationEvent.SalesOrderAssignment]: <RiProgress8Line />,
    [NotificationEvent.StockTransferAssignment]: <LuListChecks />,
    [NotificationEvent.PickingListAssignment]: <LuListChecks />,
    [NotificationEvent.SuggestionResponse]: <LuLightbulb />,
    [NotificationEvent.SupplierQuoteAssignment]: <LuDollarSign />,
    [NotificationEvent.SupplierQuoteResponse]: <LuMailCheck />,
    [NotificationEvent.TrainingAssignment]: <LuListChecks />,
    [NotificationEvent.TrainingReminder]: <LuListChecks />,
    [NotificationEvent.ResourceTrainingAssignment]: <LuGraduationCap />,
    [NotificationEvent.Workflow]: <LuGitPullRequestArrow />
  };

function GenericNotification({
  id,
  event,
  documentType,
  ...props
}: {
  id: string;
  createdAt: string;
  description: string;
  body?: string;
  event: NotificationEvent;
  from?: string;
  documentType?: NotificationDocumentType;
  markMessageAsRead?: () => void;
  onClose: () => void;
}) {
  const icon = NOTIFICATION_ICONS[event];
  if (!icon) return null;
  // The same target as the email link (`api+/link.ts`).
  const target = notificationTarget(event, id, documentType);
  return (
    <Notification
      icon={icon}
      to={target?.path ?? path.to.authenticatedRoot}
      reloadDocument={target?.download}
      {...props}
    />
  );
}

function DigestNotification({
  id,
  description,
  markMessageAsRead,
  onClose,
  fetchChildren
}: {
  id: string;
  description: string;
  markMessageAsRead?: () => void;
  onClose: () => void;
  fetchChildren: (digestId: string) => Promise<NotificationRecord[]>;
}) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<NotificationRecord[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setLoadingChildren(true);
      try {
        const rows = await fetchChildren(id);
        setChildren(rows);
      } finally {
        setLoadingChildren(false);
      }
    }
  };

  return (
    <div>
      <div className="flex items-between justify-between gap-x-4 px-3 py-3 hover:bg-secondary">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center justify-start gap-x-4 flex-1 text-left"
        >
          <div>
            <div className="h-9 w-9 flex items-center justify-center gap-y-0 border rounded-full">
              <LuInbox />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm">{description}</p>
          </div>
          <div className="text-muted-foreground">
            {expanded ? <LuChevronUp /> : <LuChevronDown />}
          </div>
        </button>
        {markMessageAsRead && (
          <div>
            <IconButton
              aria-label={t`Mark as read`}
              icon={<LuMailCheck />}
              variant="secondary"
              className="rounded-full before:rounded-full"
              onClick={markMessageAsRead}
            />
          </div>
        )}
      </div>
      {expanded && (
        <div className="bg-muted/30">
          {loadingChildren && (
            <div className="flex items-center gap-x-2 px-3 py-2 text-xs text-muted-foreground">
              <LuLoader className="animate-spin" />
              <Trans>Loading…</Trans>
            </div>
          )}
          {!loadingChildren && children && children.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              <Trans>No grouped notifications</Trans>
            </div>
          )}
          {!loadingChildren && children && children.length > 0 && (
            <div className="divide-y">
              {children.map((child) => (
                <GenericNotification
                  key={child._id}
                  id={child.payload.documentId as string}
                  createdAt={child.createdAt}
                  description={child.payload.description as string}
                  event={child.payload.event as NotificationEvent}
                  from={child.payload.from as string | undefined}
                  documentType={
                    child.payload.documentType as
                      | NotificationDocumentType
                      | undefined
                  }
                  onClose={onClose}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function usePushPublicKey() {
  return (
    useRouteData<{ pushPublicKey: string | null }>(path.to.authenticatedRoot)
      ?.pushPublicKey ?? null
  );
}

/**
 * The notification tabs (Inbox, Trainings, Archive). The desktop bell
 * popover and the compact Profile sheet's Notifications drill-in both
 * render it; the caller owns `useNotifications` so the unread badge and the
 * panel share one subscription.
 */
export function NotificationsPanel({
  isOpen,
  onClose,
  activeTab,
  onActiveTabChange,
  notifications: {
    fetchDigestChildren,
    hasUnseenNotifications,
    notifications,
    markMessageAsRead,
    markAllMessagesAsSeen,
    markAllMessagesAsRead
  }
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Owned by the caller: the desktop popover unmounts the panel on close
   * and reopens on the last tab. */
  activeTab: string;
  onActiveTabChange: (tab: string) => void;
  notifications: ReturnType<typeof useNotifications>;
}) {
  const { t } = useLingui();
  const pushPublicKey = usePushPublicKey();
  // Loaded when the tab is opened, and again each time the popover reopens.
  const trainingsFetcher = useLoaderQuery<{ data: OutstandingTraining[] }>(
    isOpen && activeTab === "trainings"
      ? path.to.api.outstandingTrainings
      : null,
    { staleTime: 0 }
  );

  const unreadNotifications = notifications.filter(
    (notification) => !notification.read
  );

  const archivedNotifications = notifications.filter(
    (notification) => notification.read
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (isOpen && hasUnseenNotifications) {
      markAllMessagesAsSeen();
    }
  }, [hasUnseenNotifications, isOpen]);

  const outstandingTrainings = trainingsFetcher.data?.data ?? [];
  const isLoadingTrainings = trainingsFetcher.isFetching;

  return (
    <Tabs
      defaultValue="inbox"
      value={activeTab}
      onValueChange={onActiveTabChange}
    >
      <TabsList className="w-full border-b py-2 rounded-none bg-muted/50">
        <TabsTrigger value="inbox" className="font-normal">
          <Trans>Inbox</Trans>
        </TabsTrigger>
        <TabsTrigger value="trainings" className="font-normal">
          <Trans>Trainings</Trans>
        </TabsTrigger>
        <TabsTrigger value="archive" className="font-normal">
          <Trans>Archive</Trans>
        </TabsTrigger>
      </TabsList>

      {/* <Link
        to={path.to.notificationSettings}
        className="absolute right-[11px] top-1.5"
      >
        <IconButton
          aria-label={t`Settings`}
          icon={<LuSettings />}
          variant="ghost"
          isIcon
          className="rounded-full"
          onClick={() => onClose()}
        />
      </Link> */}

      <TabsContent value="inbox" className="relative mt-0">
        {!unreadNotifications.length && (
          <>
            <EnableBrowserNotifications publicKey={pushPublicKey} />
            <EmptyState description={t`No new notifications`} />
          </>
        )}

        {unreadNotifications.length > 0 && (
          <ScrollArea className="pb-12 h-[485px] max-md:h-auto">
            <EnableBrowserNotifications publicKey={pushPublicKey} />
            <div className="divide-y">
              {unreadNotifications.map((notification) => {
                const event = notification.payload.event as NotificationEvent;
                if (event === NotificationEvent.Digest) {
                  return (
                    <DigestNotification
                      key={notification._id}
                      id={notification._id}
                      description={notification.payload.description as string}
                      markMessageAsRead={() =>
                        markMessageAsRead(notification._id)
                      }
                      onClose={() => onClose()}
                      fetchChildren={fetchDigestChildren}
                    />
                  );
                }
                return (
                  <GenericNotification
                    key={notification._id}
                    id={notification.payload.documentId as string}
                    createdAt={notification.createdAt}
                    description={notification.payload.description as string}
                    body={getNotificationBody(notification.payload, event)}
                    event={event}
                    from={notification.payload.from as string | undefined}
                    documentType={
                      notification.payload.documentType as
                        | NotificationDocumentType
                        | undefined
                    }
                    markMessageAsRead={() =>
                      markMessageAsRead(notification._id)
                    }
                    onClose={() => onClose()}
                  />
                );
              })}
            </div>
          </ScrollArea>
        )}

        {unreadNotifications.length > 0 && (
          <div className="h-12 w-full absolute bottom-0 flex items-center justify-center border-t">
            <Button
              variant="secondary"
              className="bg-transparent"
              onClick={markAllMessagesAsRead}
            >
              <Trans>Archive all</Trans>
            </Button>
          </div>
        )}
      </TabsContent>

      <TabsContent value="trainings" className="mt-0">
        {isLoadingTrainings && (
          <div className="h-[460px] max-md:h-auto max-md:py-16 flex items-center justify-center">
            <Spinner />
          </div>
        )}

        {!isLoadingTrainings && outstandingTrainings.length === 0 && (
          <EmptyState description={t`No outstanding trainings`} />
        )}

        {!isLoadingTrainings && outstandingTrainings.length > 0 && (
          <ScrollArea className="h-[490px] max-md:h-auto">
            <div className="divide-y">
              {outstandingTrainings.map((training) => (
                <TrainingItem
                  key={training.trainingAssignmentId}
                  training={training}
                  onClose={() => onClose()}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </TabsContent>

      <TabsContent value="archive" className="mt-0">
        {!archivedNotifications.length && (
          <EmptyState description={t`Nothing in the archive`} />
        )}

        {archivedNotifications.length > 0 && (
          <ScrollArea className="h-[490px] max-md:h-auto">
            <div className="divide-y">
              {archivedNotifications.map((notification) => {
                const event = notification.payload.event as NotificationEvent;
                if (event === NotificationEvent.Digest) {
                  return (
                    <DigestNotification
                      key={notification._id}
                      id={notification._id}
                      description={notification.payload.description as string}
                      onClose={() => onClose()}
                      fetchChildren={fetchDigestChildren}
                    />
                  );
                }
                return (
                  <GenericNotification
                    key={notification._id}
                    id={notification.payload.documentId as string}
                    createdAt={notification.createdAt}
                    description={notification.payload.description as string}
                    body={getNotificationBody(notification.payload, event)}
                    event={event}
                    from={notification.payload.from as string | undefined}
                    documentType={
                      notification.payload.documentType as
                        | NotificationDocumentType
                        | undefined
                    }
                    onClose={() => onClose()}
                  />
                );
              })}
            </div>
          </ScrollArea>
        )}
      </TabsContent>
    </Tabs>
  );
}

const Notifications = () => {
  const { t } = useLingui();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  // The bell is always mounted on desktop (the Profile sheet is on phones), so
  // it is where a signed-back-in user's browser notifications come back.
  useRestoreBrowserNotifications({ publicKey: usePushPublicKey(), userId });
  useAppBadge({ userId });
  const [isOpen, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("inbox");
  const notificationsState = useNotifications({
    companyId,
    userId
  });

  const unreadNotifications = notificationsState.notifications.filter(
    (notification) => !notification.read
  );

  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          isIcon
          className="w-8 h-8 flex items-center relative"
          aria-label={
            unreadNotifications.length > 0
              ? t`Notifications, ${unreadNotifications.length} unread`
              : t`Notifications`
          }
        >
          {unreadNotifications.length > 0 && (
            <span
              aria-hidden
              className="absolute top-0 right-0 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[0.625rem] font-medium leading-4 text-center tabular-nums"
            >
              {unreadNotifications.length}
            </span>
          )}
          <LuBell size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="h-[535px] w-screen md:w-[400px] p-0 -top-px overflow-hidden relative"
        align="end"
        sideOffset={10}
      >
        <NotificationsPanel
          isOpen={isOpen}
          onClose={() => setOpen(false)}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          notifications={notificationsState}
        />
      </PopoverContent>
    </Popover>
  );
};

export default Notifications;
