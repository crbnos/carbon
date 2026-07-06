import { useCarbon, useRealtimeChannel } from "@carbon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Notification } from "~/types";

type NotificationRow = {
  id: string;
  userId: string;
  companyId: string;
  readAt: string | null;
  seenAt: string | null;
  createdAt: string;
  payload: Notification["payload"] | null;
};

function rowToNotification(row: NotificationRow): Notification {
  return {
    _id: row.id,
    createdAt: row.createdAt,
    payload: row.payload ?? {},
    read: row.readAt !== null,
    seen: row.seenAt !== null
  };
}

export function useNotifications({
  userId,
  companyId
}: {
  userId: string;
  companyId: string;
}) {
  const { carbon } = useCarbon();
  const [isLoading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Initial fetch — runs once per (carbon/user/company) tuple.
  useEffect(() => {
    if (!carbon) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await carbon
        .from("notification")
        .select("id, userId, companyId, readAt, seenAt, createdAt, payload")
        .eq("userId", userId)
        .eq("companyId", companyId)
        .is("digestedInto", null)
        .order("createdAt", { ascending: false })
        .limit(100);

      if (cancelled) return;
      if (error) {
        console.error("Failed to load notifications", error);
        setLoading(false);
        return;
      }
      setNotifications(
        ((data ?? []) as NotificationRow[]).map(rowToNotification)
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [carbon, userId, companyId]);

  // Realtime stream — useRealtimeChannel waits for isRealtimeAuthSet so RLS
  // policies on `notification` resolve via the user's JWT.
  useRealtimeChannel({
    dependencies: [userId, companyId],
    setup(channel) {
      return channel.on(
        "postgres_changes" as any,
        {
          event: "*",
          filter: `userId=eq.${userId}`,
          schema: "public",
          table: "notification"
        },
        (payload: {
          eventType: string;
          new: NotificationRow;
          old: NotificationRow;
        }) => {
          if (payload.new && payload.new.companyId !== companyId) return;
          if (payload.eventType === "INSERT") {
            setNotifications((prev) => [
              rowToNotification(payload.new),
              ...prev
            ]);
          } else if (payload.eventType === "UPDATE") {
            // A row that just got attached to a digest disappears from the
            // topbar — it's now represented by its digest parent.
            const newRow = payload.new as NotificationRow & {
              digestedInto?: string | null;
            };
            if (newRow.digestedInto) {
              setNotifications((prev) =>
                prev.filter((n) => n._id !== newRow.id)
              );
            } else {
              setNotifications((prev) =>
                prev.map((n) =>
                  n._id === newRow.id ? rowToNotification(newRow) : n
                )
              );
            }
          } else if (payload.eventType === "DELETE") {
            setNotifications((prev) =>
              prev.filter((n) => n._id !== (payload.old as NotificationRow).id)
            );
          }
        }
      );
    },
    topic: `notification:${companyId}:${userId}`
  });

  const markMessageAsRead = useCallback(
    async (messageId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n._id === messageId ? { ...n, read: true } : n))
      );
      if (!carbon) return;
      const now = new Date().toISOString();
      await carbon
        .from("notification")
        .update({ readAt: now })
        .eq("id", messageId);
      // If this is a digest row, sweep its children read too. RLS scopes
      // both updates to auth.uid()::text = userId, so a malicious id won't
      // affect anyone else.
      await carbon
        .from("notification")
        .update({ readAt: now })
        .eq("digestedInto", messageId)
        .is("readAt", null);
    },
    [carbon]
  );

  // Lazily loads child rows for a digest parent. The topbar query filters out
  // anything with `digestedInto` set, so children aren't in `notifications` —
  // we fetch them on demand when the user expands a digest.
  const fetchDigestChildren = useCallback(
    async (digestId: string): Promise<Notification[]> => {
      if (!carbon) return [];
      const { data, error } = await carbon
        .from("notification")
        .select("id, userId, companyId, readAt, seenAt, createdAt, payload")
        .eq("digestedInto", digestId)
        .order("createdAt", { ascending: false });
      if (error) {
        console.error("Failed to load digest children", error);
        return [];
      }
      return ((data ?? []) as NotificationRow[]).map(rowToNotification);
    },
    [carbon]
  );

  const markAllMessagesAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (!carbon) return;
    await carbon
      .from("notification")
      .update({ readAt: new Date().toISOString() })
      .eq("userId", userId)
      .eq("companyId", companyId)
      .is("readAt", null);
  }, [carbon, userId, companyId]);

  const markAllMessagesAsSeen = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, seen: true })));
    if (!carbon) return;
    await carbon
      .from("notification")
      .update({ seenAt: new Date().toISOString() })
      .eq("userId", userId)
      .eq("companyId", companyId)
      .is("seenAt", null);
  }, [carbon, userId, companyId]);

  const hasUnseenNotifications = useMemo(
    () => notifications.some((n) => !n.seen),
    [notifications]
  );

  return {
    fetchDigestChildren,
    hasUnseenNotifications,
    isLoading,
    markAllMessagesAsRead,
    markAllMessagesAsSeen,
    markMessageAsRead,
    notifications
  };
}
