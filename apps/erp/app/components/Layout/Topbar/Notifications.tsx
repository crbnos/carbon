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
import { formatTimeAgo } from "@carbon/utils";
import { useEffect, useState } from "react";
import {
  LuBell,
  LuCalendarX,
  LuCircleGauge,
  LuDollarSign,
  LuGraduationCap,
  LuHammer,
  LuHardHat,
  LuInbox,
  LuLightbulb,
  LuListChecks,
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
import { useNotifications, useUser } from "~/hooks";
import { usePeople } from "~/stores";
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
  const [people] = usePeople();
  let byUser = "";
  if (from) {
    if (from === userId) {
      byUser = "yourself";
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
            {description} {byUser && <span>by {byUser}</span>}
          </p>
          <span className="text-xs text-muted-foreground">
            {formatTimeAgo(createdAt)}
          </span>
        </div>
      </Link>
      {markMessageAsRead && (
        <div>
          <IconButton
            aria-label="Mark as read"
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
  ...props
}: {
  id: string;
  createdAt: string;
  description: string;
  event: NotificationEvent;
  from?: string;
  markMessageAsRead?: () => void;
  onClose: () => void;
}) {
  switch (event) {
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
              <LuHardHat />
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
    default:
      return null;
  }
}

const Notifications = () => {
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  const [isOpen, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("inbox");
  const [trainingsLoaded, setTrainingsLoaded] = useState(false);
  const trainingsFetcher = useFetcher<{ data: OutstandingTraining[] }>();

  const {
    hasUnseenNotifications,
    notifications,
    markMessageAsRead,
    markAllMessagesAsSeen,
    markAllMessagesAsRead
  } = useNotifications({
    userId,
    companyId
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
        className="h-[535px] w-screen md:w-[400px] p-0 overflow-hidden relative"
        align="end"
        sideOffset={10}
      >
        <Tabs
          defaultValue="inbox"
          value={activeTab}
          onValueChange={setActiveTab}
        >
          <TabsList className="w-full border-b-[1px] py-6 rounded-none bg-muted/[0.5]">
            <TabsTrigger value="inbox" className="font-normal">
              Inbox
            </TabsTrigger>
            <TabsTrigger value="trainings" className="font-normal">
              Trainings
            </TabsTrigger>
            <TabsTrigger value="archive" className="font-normal">
              Archive
            </TabsTrigger>
          </TabsList>

          {/* <Link
            to={path.to.notificationSettings}
            className="absolute right-[11px] top-1.5"
          >
            <IconButton
              aria-label="Settings"
              icon={<LuSettings />}
              variant="ghost"
              isIcon
              className="rounded-full"
              onClick={() => setOpen(false)}
            />
          </Link> */}

          <TabsContent value="inbox" className="relative mt-0">
            {!unreadNotifications.length && (
              <EmptyState description="No new notifications" />
            )}

            {unreadNotifications.length > 0 && (
              <ScrollArea className="pb-12 h-[485px]">
                <div className="divide-y">
                  {unreadNotifications.map((notification) => {
                    return (
                      <GenericNotification
                        key={notification._id}
                        id={notification.payload.recordId as string}
                        createdAt={notification.createdAt}
                        description={notification.payload.description as string}
                        event={notification.payload.event as NotificationEvent}
                        from={notification.payload.from as string | undefined}
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
              <div className="h-12 w-full absolute bottom-0 flex items-center justify-center border-t-[1px]">
                <Button
                  variant="secondary"
                  className="bg-transparent"
                  onClick={markAllMessagesAsRead}
                >
                  Archive all
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
              <EmptyState description="No outstanding trainings" />
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
              <EmptyState description="Nothing in the archive" />
            )}

            {archivedNotifications.length > 0 && (
              <ScrollArea className="h-[490px]">
                <div className="divide-y">
                  {archivedNotifications.map((notification) => {
                    return (
                      <GenericNotification
                        key={notification._id}
                        id={notification.payload.recordId as string}
                        createdAt={notification.createdAt}
                        description={notification.payload.description as string}
                        event={notification.payload.event as NotificationEvent}
                        from={notification.payload.from as string | undefined}
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
