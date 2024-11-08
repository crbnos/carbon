import type { IMessage } from "@novu/headless";
import { HeadlessService } from "@novu/headless";
import { useCallback, useEffect, useRef, useState } from "react";
import useMount from "./useMount";

export function getSubscriberId({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  return `${companyId}:${userId}`;
}

export function useNotifications({
  userId,
  companyId,
}: {
  userId: string;
  companyId: string;
}) {
  const [isLoading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<IMessage[]>([]);
  const [subscriberId, setSubscriberId] = useState<string>();
  const headlessServiceRef = useRef<HeadlessService>();

  const markAllMessagesAsRead = () => {
    const headlessService = headlessServiceRef.current;

    if (headlessService) {
      setNotifications((prevNotifications) =>
        prevNotifications.map((notification) => {
          return {
            ...notification,
            read: true,
          };
        })
      );

      headlessService.markAllMessagesAsRead({
        listener: () => {},
        onError: () => {},
      });
    }
  };

  const markMessageAsRead = (messageId: string) => {
    const headlessService = headlessServiceRef.current;

    if (headlessService) {
      setNotifications((prevNotifications) =>
        prevNotifications.map((notification) => {
          if (notification._id === messageId) {
            return {
              ...notification,
              read: true,
            };
          }

          return notification;
        })
      );

      headlessService.markNotificationsAsRead({
        messageId: [messageId],
        listener: (result) => {},
        onError: (error) => {},
      });
    }
  };

  const fetchNotifications = useCallback(() => {
    const headlessService = headlessServiceRef.current;

    if (headlessService) {
      headlessService.fetchNotifications({
        listener: ({}) => {},
        onSuccess: (response) => {
          setLoading(false);
          setNotifications(response.data);
        },
      });
    }
  }, []);

  const markAllMessagesAsSeen = () => {
    const headlessService = headlessServiceRef.current;

    if (headlessService) {
      setNotifications((prevNotifications) =>
        prevNotifications.map((notification) => ({
          ...notification,
          seen: true,
        }))
      );
      headlessService.markAllMessagesAsSeen({
        listener: () => {},
        onError: () => {},
      });
    }
  };

  useMount(() => {
    setSubscriberId(getSubscriberId({ companyId, userId }));
  });

  useEffect(() => {
    const headlessService = headlessServiceRef.current;

    if (headlessService) {
      headlessService.listenNotificationReceive({
        listener: () => {
          fetchNotifications();
        },
      });
    }
  }, [headlessServiceRef.current]);

  useEffect(() => {
    if (subscriberId && !headlessServiceRef.current) {
      const headlessService = new HeadlessService({
        applicationIdentifier: "QJrtAikHM3x0",
        subscriberId,
      });

      headlessService.initializeSession({
        listener: () => {},
        onSuccess: () => {
          headlessServiceRef.current = headlessService;
          fetchNotifications();
        },
        onError: () => {},
      });
    }
  }, [fetchNotifications, subscriberId]);

  return {
    isLoading,
    markAllMessagesAsRead,
    markMessageAsRead,
    markAllMessagesAsSeen,
    hasUnseenNotifications: notifications.some(
      (notification) => !notification.seen
    ),
    notifications,
  };
}
