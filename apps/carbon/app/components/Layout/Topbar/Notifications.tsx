"use client";

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
  useNotifications,
} from "@carbon/react";
import { formatTimeAgo } from "@carbon/utils";
import { Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  LuBell,
  LuClipboardCheck,
  LuInbox,
  LuMailCheck,
  LuSettings,
} from "react-icons/lu";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";

function EmptyState({ description }: { description: string }) {
  return (
    <div className="h-[460px] flex items-center justify-center flex-col gap-y-4">
      <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
        <LuInbox size={18} />
      </div>
      <p className="text-[#606060] text-sm">{description}</p>
    </div>
  );
}

function Notification({
  icon,
  to,
  description,
  createdAt,
  markMessageAsRead,
  onClose,
}: {
  icon: React.ReactNode;
  to: string;
  description: string;
  createdAt: string;
  markMessageAsRead?: () => void;
  onClose: () => void;
}) {
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
          <p className="text-sm">{description}</p>
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
            className="rounded-full bg-transparent"
            onClick={markMessageAsRead}
          />
        </div>
      )}
    </div>
  );
}

function NotificationType({
  type,
  ...props
}: {
  id: string;
  createdAt: string;
  description: string;
  type: string;
  markMessageAsRead?: () => void;
  onClose: () => void;
}) {
  switch (type) {
    case "assignment":
      return <Notification icon={<LuClipboardCheck />} to="#" {...props} />;

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
  }, [hasUnseenNotifications, isOpen]);

  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          isIcon
          className="rounded-full w-8 h-8 flex items-center relative"
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
          <TabsList className="w-full border-b-[1px] py-6 rounded-none">
            <TabsTrigger value="inbox" className="font-normal">
              Inbox
            </TabsTrigger>
            <TabsTrigger value="archive" className="font-normal">
              Archive
            </TabsTrigger>
          </TabsList>

          <Link
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
          </Link>

          <TabsContent value="inbox" className="relative mt-0">
            {!unreadNotifications.length && (
              <EmptyState description="No new notifications" />
            )}

            {unreadNotifications.length > 0 && (
              <ScrollArea className="pb-12 h-[485px]">
                <div className="divide-y">
                  {unreadNotifications.map((notification) => {
                    return (
                      <NotificationType
                        key={notification._id}
                        id={notification.payload.recordId as string}
                        createdAt={notification.createdAt}
                        description={notification.payload.description as string}
                        type={notification.payload.type as string}
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
                      <NotificationType
                        key={notification._id}
                        id={notification.payload.recordId as string}
                        createdAt={notification.createdAt}
                        description={notification.payload.description as string}
                        type={notification.payload.type as string}
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
