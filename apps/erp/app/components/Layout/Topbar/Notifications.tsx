"use client";
import { NotificationEvent } from "@carbon/notifications";
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
  TabsTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuBell,
  LuCalendarX,
  LuChevronDown,
  LuChevronUp,
  LuCircleGauge,
  LuCirclePlay,
  LuClipboardCheck,
  LuDollarSign,
  LuGraduationCap,
  LuHammer,
  LuInbox,
  LuLightbulb,
  LuListChecks,
  LuLoader,
  LuMailCheck,
  LuMessageSquare,
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
import { Link, useFetcher } from "react-router";
import { useDateFormatter, useNotifications, useUser } from "~/hooks";
import type { ApprovalDocumentType } from "~/modules/shared";
import { usePeople } from "~/stores";
import type { Notification as NotificationRecord } from "~/types";
import { path } from "~/utils/path";

type OutstandingTraining = {
  trainingAssignmentId: string;
  trainingId: string;
  trainingName: string;
  frequency: string;
  trainingType: string;
  status: "Pending" | "Overdue";
  currentPeriod: string | null;
};

function EmptyState({ description }: { description: string }) {
  return (
    <div className="h-[460px] flex items-center justify-center flex-col gap-y-4">
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
  description,
  createdAt,
  markMessageAsRead,
  from,
  onClose
}: {
  icon: React.ReactNode;
  to: string;
  description: string;
  createdAt: string;
  from?: string;
  markMessageAsRead?: () => void;
  onClose: () => void;
}) {
  const { id: userId } = useUser();
  const { t } = useLingui();
  const { formatTimeAgo } = useDateFormatter();
  const [people] = usePeople();
  let byUser = "";
  if (from) {
    if (from === userId) {
      byUser = t`yourself`;
    } else {
      byUser = people.find((p) => p.id === from)?.name ?? "";
    }
  }
  return (
    <div className="flex items-between justify-between gap-x-4 px-3 py-3 hover:bg-secondary">
      <Link
        className="flex items-between justify-between gap-x-4 "
        onClick={() => onClose()}
        to={to}
      >
        <div>
          <div className="h-9 w-9 flex items-center justify-center gap-y-0 border rounded-full">
            {icon}
          </div>
        </div>
        <div>
          <p className="text-sm">
            {description} {byUser && <span>{t`by ${byUser}`}</span>}
          </p>
          <span className="text-xs text-muted-foreground">
            {formatTimeAgo(createdAt)}
          </span>
        </div>
      </Link>
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

function GenericNotification({
  id,
  event,
  documentType,
  ...props
}: {
  id: string;
  createdAt: string;
  description: string;
  event: NotificationEvent;
  from?: string;
  documentType?: ApprovalDocumentType;
  markMessageAsRead?: () => void;
  onClose: () => void;
}) {
  switch (event) {
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
    case NotificationEvent.ApprovalRequested:
      return (
        <Notification
          icon={<LuClipboardCheck />}
          to={
            documentType === "qualityDocument"
              ? path.to.qualityDocument(id)
              : path.to.purchaseOrderDetails(id)
          }
          {...props}
        />
      );
    case NotificationEvent.DigitalQuoteResponse:
      return (
        <Notification
          icon={<LuDollarSign />}
          to={path.to.quoteDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.GaugeCalibrationExpired:
      return (
        <Notification
          icon={<LuCircleGauge />}
          to={path.to.gauge(id)}
          {...props}
        />
      );
    case NotificationEvent.JobCompleted:
    case NotificationEvent.JobAssignment:
      return (
        <Notification
          icon={<LuHammer />}
          to={path.to.jobDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage:
      const [jobId, operationId, makeMethodId, materialId] = id.split(":");
      const link = materialId
        ? path.to.jobMakeMethod(jobId, makeMethodId)
        : path.to.jobMethod(jobId, makeMethodId);

      return (
        <Notification
          icon={
            event === NotificationEvent.JobOperationMessage ? (
              <LuMessageSquare />
            ) : (
              <LuCirclePlay />
            )
          }
          to={`${link}?selectedOperation=${operationId}`}
          {...props}
        />
      );
    case NotificationEvent.MaintenanceDispatchCreated:
    case NotificationEvent.MaintenanceDispatchAssignment:
      return (
        <Notification
          icon={<LuWrench />}
          to={path.to.maintenanceDispatch(id)}
          {...props}
        />
      );
    case NotificationEvent.NonConformanceAssignment:
      return (
        <Notification icon={<LuShieldX />} to={path.to.issue(id)} {...props} />
      );
    case NotificationEvent.ProcedureAssignment:
      return (
        <Notification
          icon={<LuListChecks />}
          to={path.to.procedure(id)}
          {...props}
        />
      );
    case NotificationEvent.QuoteExpired:
      return (
        <Notification
          icon={<LuCalendarX />}
          to={path.to.quoteDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.PurchaseInvoiceAssignment:
      return (
        <Notification
          icon={<LuShoppingCart />}
          to={path.to.purchaseInvoiceDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.PurchaseOrderAssignment:
      return (
        <Notification
          icon={<LuShoppingCart />}
          to={path.to.purchaseOrderDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.QuoteAssignment:
      return (
        <Notification
          icon={<RiProgress4Line />}
          to={path.to.quoteDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.RiskAssignment:
      return (
        <Notification
          icon={<LuShieldAlert />}
          to={path.to.risk(id)}
          {...props}
        />
      );
    case NotificationEvent.SalesRfqReady:
    case NotificationEvent.SalesRfqAssignment:
      return (
        <Notification
          icon={<RiProgress2Line />}
          to={path.to.salesRfq(id)}
          {...props}
        />
      );
    case NotificationEvent.SalesOrderAssignment:
      return (
        <Notification
          icon={<RiProgress8Line />}
          to={path.to.salesOrderDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.StockTransferAssignment:
      return (
        <Notification
          icon={<LuListChecks />}
          to={path.to.salesOrderDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.PickingListAssignment:
      return (
        <Notification
          icon={<LuListChecks />}
          to={path.to.pickingList(id)}
          {...props}
        />
      );
    case NotificationEvent.SuggestionResponse:
      return (
        <Notification
          icon={<LuLightbulb />}
          to={path.to.suggestion(id)}
          {...props}
        />
      );
    case NotificationEvent.SupplierQuoteAssignment:
      return (
        <Notification
          icon={<LuDollarSign />}
          to={path.to.supplierQuoteDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.SupplierQuoteResponse:
      return (
        <Notification
          icon={<LuMailCheck />}
          to={path.to.supplierQuoteDetails(id)}
          {...props}
        />
      );
    case NotificationEvent.TrainingAssignment:
      return (
        <Notification
          icon={<LuListChecks />}
          to={path.to.completeTrainingAssignment(id)}
          {...props}
        />
      );
    case NotificationEvent.Digest:
      // Digest rows are rendered by DigestNotification (expandable). This
      // branch is unreachable when GenericNotification is used from the
      // topbar maps — kept as a defensive fallback.
      return null;
    default:
      return null;
  }
}

function DigestNotification({
  id,
  description,
  createdAt,
  markMessageAsRead,
  onClose,
  fetchChildren
}: {
  id: string;
  description: string;
  createdAt: string;
  markMessageAsRead?: () => void;
  onClose: () => void;
  fetchChildren: (digestId: string) => Promise<NotificationRecord[]>;
}) {
  const { t } = useLingui();
  const { formatTimeAgo } = useDateFormatter();
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
            <span className="text-xs text-muted-foreground">
              {formatTimeAgo(createdAt)}
            </span>
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
                      | ApprovalDocumentType
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

const Notifications = () => {
  const { t } = useLingui();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  const [isOpen, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("inbox");
  const [trainingsLoaded, setTrainingsLoaded] = useState(false);
  const trainingsFetcher = useFetcher<{ data: OutstandingTraining[] }>();

  const {
    fetchDigestChildren,
    hasUnseenNotifications,
    notifications,
    markMessageAsRead,
    markAllMessagesAsSeen,
    markAllMessagesAsRead
  } = useNotifications({
    companyId,
    userId
  });

  const unreadNotifications = notifications.filter(
    (notification) => !notification.read
  );

  const archivedNotifications = notifications.filter(
    (notification) => notification.read
  );

  // Lazy load trainings when the tab is selected
  useEffect(() => {
    if (activeTab === "trainings" && !trainingsLoaded && isOpen) {
      trainingsFetcher.load(path.to.api.outstandingTrainings);
      setTrainingsLoaded(true);
    }
  }, [activeTab, trainingsLoaded, isOpen, trainingsFetcher]);

  // Reset trainings loaded state when popover closes
  useEffect(() => {
    if (!isOpen) {
      setTrainingsLoaded(false);
    }
  }, [isOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (isOpen && hasUnseenNotifications) {
      markAllMessagesAsSeen();
    }
  }, [hasUnseenNotifications, isOpen]);

  const outstandingTrainings = trainingsFetcher.data?.data ?? [];
  const isLoadingTrainings = trainingsFetcher.state === "loading";

  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          isIcon
          className="w-8 h-8 flex items-center relative"
        >
          {hasUnseenNotifications && (
            <div className="w-2 h-2 bg-red-500 rounded-full absolute top-0 right-0" />
          )}
          <LuBell size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="h-[535px] w-screen md:w-[400px] p-0 -top-px overflow-hidden relative"
        align="end"
        sideOffset={10}
      >
        <Tabs
          defaultValue="inbox"
          value={activeTab}
          onValueChange={setActiveTab}
        >
          <TabsList className="w-full border-b py-6 rounded-none bg-muted/50">
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
              onClick={() => setOpen(false)}
            />
          </Link> */}

          <TabsContent value="inbox" className="relative mt-0">
            {!unreadNotifications.length && (
              <EmptyState description={t`No new notifications`} />
            )}

            {unreadNotifications.length > 0 && (
              <ScrollArea className="pb-12 h-[485px]">
                <div className="divide-y">
                  {unreadNotifications.map((notification) => {
                    const event = notification.payload
                      .event as NotificationEvent;
                    if (event === NotificationEvent.Digest) {
                      return (
                        <DigestNotification
                          key={notification._id}
                          id={notification._id}
                          createdAt={notification.createdAt}
                          description={
                            notification.payload.description as string
                          }
                          markMessageAsRead={() =>
                            markMessageAsRead(notification._id)
                          }
                          onClose={() => setOpen(false)}
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
                        event={event}
                        from={notification.payload.from as string | undefined}
                        documentType={
                          notification.payload.documentType as
                            | ApprovalDocumentType
                            | undefined
                        }
                        markMessageAsRead={() =>
                          markMessageAsRead(notification._id)
                        }
                        onClose={() => setOpen(false)}
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
              <div className="h-[460px] flex items-center justify-center">
                <Spinner />
              </div>
            )}

            {!isLoadingTrainings && outstandingTrainings.length === 0 && (
              <EmptyState description={t`No outstanding trainings`} />
            )}

            {!isLoadingTrainings && outstandingTrainings.length > 0 && (
              <ScrollArea className="h-[490px]">
                <div className="divide-y">
                  {outstandingTrainings.map((training) => (
                    <TrainingItem
                      key={training.trainingAssignmentId}
                      training={training}
                      onClose={() => setOpen(false)}
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
              <ScrollArea className="h-[490px]">
                <div className="divide-y">
                  {archivedNotifications.map((notification) => {
                    const event = notification.payload
                      .event as NotificationEvent;
                    if (event === NotificationEvent.Digest) {
                      return (
                        <DigestNotification
                          key={notification._id}
                          id={notification._id}
                          createdAt={notification.createdAt}
                          description={
                            notification.payload.description as string
                          }
                          onClose={() => setOpen(false)}
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
                        event={event}
                        from={notification.payload.from as string | undefined}
                        documentType={
                          notification.payload.documentType as
                            | ApprovalDocumentType
                            | undefined
                        }
                        onClose={() => setOpen(false)}
                      />
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
};

export default Notifications;
