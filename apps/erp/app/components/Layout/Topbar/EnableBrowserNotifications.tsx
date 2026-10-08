// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { now, parseAbsolute } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { usePushSubscription } from "~/hooks/usePushSubscription";

// The soft ask: our own row, so a user who is not interested says no to us,
// not to the browser — a browser "Block" is close to permanent. The native
// prompt only ever opens from the Enable click.
//
// "Not now" hides the row for SNOOZE_DAYS in this browser; the second
// "Not now" hides it for good. Account → Notifications always keeps the
// switch.
const SNOOZE_DAYS = 30;
const MAX_DISMISSALS = 2;

type Dismissal = { count: number; until: string | null };

const storageKey = (userId: string) => `browserNotificationsPrompt:${userId}`;

function readDismissal(userId: string): Dismissal {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw) return JSON.parse(raw) as Dismissal;
  } catch {
    // private mode / storage disabled / a malformed value: ask again
  }
  return { count: 0, until: null };
}

function isSnoozed(dismissal: Dismissal) {
  if (dismissal.count >= MAX_DISMISSALS) return true;
  if (!dismissal.until) return false;
  try {
    return now("UTC").compare(parseAbsolute(dismissal.until, "UTC")) < 0;
  } catch {
    return false;
  }
}

// Only a user who has not decided yet is asked: granted means push is on or
// can be turned on in settings, denied means the browser will not ask again.
function canAsk() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Notification.permission === "default"
  );
}

export function EnableBrowserNotifications({
  publicKey,
  userId
}: {
  publicKey: string | null;
  userId: string;
}) {
  // Decided after mount: localStorage and the Notification API exist only in
  // the browser.
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    setEligible(
      Boolean(publicKey) && canAsk() && !isSnoozed(readDismissal(userId))
    );
  }, [publicKey, userId]);

  if (!eligible || !publicKey) return null;

  return (
    <EnableBrowserNotificationsRow
      publicKey={publicKey}
      onDismiss={() => {
        const previous = readDismissal(userId);
        const next: Dismissal = {
          count: previous.count + 1,
          until: now("UTC").add({ days: SNOOZE_DAYS }).toAbsoluteString()
        };
        try {
          window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
        } catch {
          // storage disabled: the row simply comes back next time
        }
        setEligible(false);
      }}
    />
  );
}

function EnableBrowserNotificationsRow({
  publicKey,
  onDismiss
}: {
  publicKey: string;
  onDismiss: () => void;
}) {
  const { state, busy, turnOn } = usePushSubscription({ publicKey });

  // Enabled, blocked from the prompt, or unsupported after all: nothing left
  // to ask here.
  if (state !== "off") return null;

  return (
    <div className="flex flex-col gap-2 border-b bg-muted/30 px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">
          <Trans>Enable browser notifications</Trans>
        </p>
        <p className="text-xs text-muted-foreground">
          <Trans>Get your Carbon notifications as they happen.</Trans>
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={turnOn}
          isDisabled={busy}
          isLoading={busy}
        >
          <Trans>Enable</Trans>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onDismiss}
          isDisabled={busy}
        >
          <Trans>Not now</Trans>
        </Button>
      </div>
    </div>
  );
}
