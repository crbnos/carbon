// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  AccountSettingsSection,
  AccountSettings as SharedAccountSettings
} from "@carbon/account/ui";
import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useUser } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { usePushSubscription } from "~/hooks/usePushSubscription";
import { TwoFactorUpgradeDialog } from "~/modules/settings";
import { path } from "~/utils/path";
import { dismissBrowserNotificationsPrompt } from "~/utils/push";

/**
 * The shared account settings modal, with the two pieces only the ERP has:
 * browser push (its service worker lives on this origin) and the two-factor
 * plan gate.
 */
export default function AccountSettings() {
  const user = useUser();
  const { isGated } = usePlanGate({ feature: "TWO_FACTOR" });

  return (
    <SharedAccountSettings
      api={path.to.api.root}
      user={user}
      companyId={user.company.id}
      renderBrowserNotifications={(publicKey) => (
        <BrowserNotificationsSection publicKey={publicKey} />
      )}
      twoFactor={{
        isGated,
        renderUpgrade: (props) => <TwoFactorUpgradeDialog {...props} />
      }}
    />
  );
}

function BrowserNotificationsSection({ publicKey }: { publicKey: string }) {
  const device = usePushSubscription({ publicKey });

  return (
    <AccountSettingsSection
      title={<Trans>Browser notifications</Trans>}
      description={
        <>
          {device.state === "off" && (
            <Trans>Get your Carbon notifications as they happen.</Trans>
          )}
          {device.state === "on" && (
            <Trans>Browser notifications are on for this browser.</Trans>
          )}
          {device.state === "denied" && (
            <Trans>
              Notifications are blocked for Carbon in this browser&apos;s site
              settings.
            </Trans>
          )}
          {device.state === "unsupported" && (
            <Trans>
              This browser does not support push notifications. On iPhone or
              iPad, add Carbon to the Home Screen first.
            </Trans>
          )}
        </>
      }
      action={
        <>
          {device.state === "off" && (
            <Button
              type="button"
              variant="primary"
              onClick={device.turnOn}
              isDisabled={device.busy}
              isLoading={device.busy}
            >
              <Trans>Enable</Trans>
            </Button>
          )}
          {device.state === "on" && (
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                // Off for this browser, for everyone: the bell stops
                // offering it too — but only once it is really off.
                if (await device.turnOff()) {
                  dismissBrowserNotificationsPrompt({ permanently: true });
                }
              }}
              isDisabled={device.busy}
            >
              <Trans>Disable</Trans>
            </Button>
          )}
        </>
      }
    />
  );
}
