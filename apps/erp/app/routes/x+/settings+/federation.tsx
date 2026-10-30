// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { usePlanGate } from "~/hooks/usePlanGate";
import { ApiKeysUpgradeOverlay, FederationTabs } from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Identity Federation`,
  to: path.to.federationRules
};

export default function FederationRoute() {
  // Federation mints API keys, so it shares their plan and upgrade pitch.
  const { isGated } = usePlanGate({ feature: "API_KEYS" });

  if (isGated) {
    return <ApiKeysUpgradeOverlay />;
  }
  return (
    <div className="flex h-full w-full flex-col">
      <FederationTabs />
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <RecordOutlet />
      </div>
    </div>
  );
}
