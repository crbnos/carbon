// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect } from "react";
import { LuInfo, LuTriangleAlert, LuX } from "react-icons/lu";
import { Alert } from "./Alert";
import useLocalStorage from "./hooks/useLocalStorage";
import { IconButton } from "./IconButton";

export type AnnouncementBarAnnouncement = {
  id: string;
  message: string;
  severity: "info" | "warning" | "critical";
  href?: string;
  linkLabel?: string;
  dismissible: boolean;
};

const VARIANT = {
  info: "info",
  warning: "warning",
  critical: "destructive"
} as const;

// Full-height pages size themselves from the viewport, so the bar's height is
// published for them to subtract. Keep in step with the `h-9` below.
const HEIGHT_VARIABLE = "--announcement-height";
const HEIGHT = "2.25rem";

/**
 * A one-line announcement across the top of the app's content. A dismissal is
 * remembered in this browser per user and announcement id, so a new id shows
 * the bar again. The message is remote content and is rendered as text only.
 */
export function AnnouncementBar({
  announcement,
  userId,
  dismissLabel,
  defaultLinkLabel
}: {
  announcement: AnnouncementBarAnnouncement | null | undefined;
  userId: string;
  dismissLabel: string;
  defaultLinkLabel: string;
}) {
  const [dismissedId, setDismissedId] = useLocalStorage<string | null>(
    `announcement-dismissed:${userId}`,
    null
  );
  const visible =
    !!announcement &&
    !(announcement.dismissible && dismissedId === announcement.id);

  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    root.style.setProperty(HEIGHT_VARIABLE, HEIGHT);
    return () => {
      root.style.removeProperty(HEIGHT_VARIABLE);
    };
  }, [visible]);

  if (!visible || !announcement) return null;

  const Icon = announcement.severity === "info" ? LuInfo : LuTriangleAlert;

  return (
    <Alert
      variant={VARIANT[announcement.severity]}
      className="flex h-9 shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 px-3 py-0 text-sm"
    >
      <Icon className="shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={announcement.message}>
        {announcement.message}
      </span>
      {announcement.href && (
        <a
          href={announcement.href}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 font-medium underline underline-offset-2"
        >
          {announcement.linkLabel ?? defaultLinkLabel}
        </a>
      )}
      {announcement.dismissible && (
        <IconButton
          aria-label={dismissLabel}
          variant="ghost"
          size="sm"
          icon={<LuX />}
          onClick={() => setDismissedId(announcement.id)}
        />
      )}
    </Alert>
  );
}
