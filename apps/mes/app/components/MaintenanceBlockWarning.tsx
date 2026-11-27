// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MaintenanceBlock } from "@carbon/lib/production/floor";
import { Alert, AlertTitle } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuWrench } from "react-icons/lu";

// Shown while an open maintenance dispatch blocks the operation's work center:
// the timer Start refuses it, so the view disables Start. Pausing still works.
export function MaintenanceBlockWarning({
  block
}: {
  block: MaintenanceBlock;
}) {
  const { t } = useLingui();
  return (
    <Alert variant="destructive">
      <LuWrench className="size-4" />
      <AlertTitle>
        {block.dispatchReadableId
          ? t`Down for maintenance · ${block.dispatchReadableId}`
          : t`Down for maintenance`}
      </AlertTitle>
    </Alert>
  );
}
