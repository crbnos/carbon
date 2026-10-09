// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { usePushSubscription } from "~/hooks/usePushSubscription";
import {
  areBrowserNotificationsEnabled,
  dismissBrowserNotificationsPrompt,
  isPromptSnoozed,
  readPromptDismissal,
  supportsPush
} from "~/utils/push";

// The soft ask: our own row, so a user who is not interested says no to us,
// not to the browser — a browser "Block" is close to permanent. The native
// prompt only ever opens from the Enable click.
//
// Browser notifications are a setting of this browser, so the row is offered
// only until anyone enables them here; after that, whoever signs in gets
// their own (useRestoreBrowserNotifications).
function canAsk() {
  return supportsPush() && Notification.permission !== "denied";
}

export function EnableBrowserNotifications({
  publicKey
}: {
  publicKey: string | null;
}) {
  // Decided once, when the row mounts. The bell's popover renders its content
  // only while open, so this never runs on the server; the window check in
  // supportsPush keeps it safe if that changes.
  const [eligible, setEligible] = useState(
    () =>
      Boolean(publicKey) &&
      canAsk() &&
      !areBrowserNotificationsEnabled() &&
      !isPromptSnoozed(readPromptDismissal())
  );

  if (!eligible || !publicKey) return null;

  return (
    <EnableBrowserNotificationsRow
      publicKey={publicKey}
      onDismiss={() => {
        dismissBrowserNotificationsPrompt();
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
