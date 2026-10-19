// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { useTopic } from "@carbon/query";
import { useCarbon } from "@carbon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Notification } from "~/types";

const logger = getLogger("erp", "usenotifications");

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
  // Bumped to run the initial load again (a reconnect, a bulk change).
  const [reloads, setReloads] = useState(0);

  // Initial fetch — runs once per (carbon/user/company) tuple, and again when
  // `reloads` is bumped.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloads` is a trigger, not an input
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
        logger.error("Failed to load notifications", error);
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
  }, [carbon, userId, companyId, reloads]);

  // Realtime stream. A broadcast names the rows that changed and nothing else,
  // so they are re-read here: table RLS limits that read to this user's rows.
  useTopic(`user:${userId}:notification`, async (change) => {
    // A reconnect or a bulk change: load the list again.
    if (!change?.ids || !carbon) {
      setReloads((n) => n + 1);
      return;
    }
    const { op, ids } = change;
    if (op === "DELETE") {
      setNotifications((prev) => prev.filter((n) => !ids.includes(n._id)));
      return;
    }
    const { data, error } = await carbon
      .from("notification")
      .select(
        "id, userId, companyId, readAt, seenAt, createdAt, payload, digestedInto"
      )
      .in("id", ids)
      .eq("companyId", companyId);
    if (error) {
      logger.error("Failed to load changed notifications", error);
      return;
    }
    const rows = (data ?? []) as (NotificationRow & {
      digestedInto?: string | null;
    })[];
    setNotifications((prev) => {
      // A row attached to a digest — on insert or later — is represented
      // by its digest parent, never shown on its own.
      const changed = new Set(ids);
      const kept = prev.filter((n) => !changed.has(n._id));
      const shown = rows
        .filter((row) => !row.digestedInto)
        .map(rowToNotification);
      return [...shown, ...kept].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
    });
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
        logger.error("Failed to load digest children", error);
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
