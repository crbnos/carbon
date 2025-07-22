"use client";

import { NotificationEvent } from "@carbon/notifications";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@carbon/react";
import { formatTimeAgo } from "@carbon/utils";
import { Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  LuBell,
  LuCalendarX,
  LuDollarSign,
  LuHammer,
  LuHardHat,
  LuInbox,
  LuListChecks,
  LuMailCheck,
  LuMessageSquare,
  LuShieldX,
  LuShoppingCart,
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { useNotifications, useUser } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

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

function Notification({
  icon,
  to,
  description,
  createdAt,
  markMessageAsRead,
  from,
  onClose,
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
    case NotificationEvent.SupplierQuoteAssignment:
      return (
        <Notification
          icon={<LuDollarSign />}
          to={path.to.supplierQuoteDetails(id)}
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
    company: { id: companyId },
  } = useUser();
  const [isOpen, setOpen] = useState(false);
  const {
    hasUnseenNotifications,
    notifications,
    markMessageAsRead,
    markAllMessagesAsSeen,
    markAllMessagesAsRead,
  } = useNotifications({
    userId,
    companyId,
  });

  const unreadNotifications = notifications.filter(
    (notification) => !notification.read
  );

  const archivedNotifications = notifications.filter(
    (notification) => notification.read
  );

  useEffect(() => {
    if (isOpen && hasUnseenNotifications) {
      markAllMessagesAsSeen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnseenNotifications, isOpen]);

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
        <Tabs defaultValue="inbox">
          <TabsList className="w-full border-b-[1px] py-6 rounded-none bg-muted/[0.5]">
            <TabsTrigger value="inbox" className="font-normal">
              Inbox
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
