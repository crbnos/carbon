// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { PURCHASE_ORDER_STATUS_COLOR_MAP } from "@carbon/utils";
import type { purchaseOrderStatusType } from "~/modules/purchasing";

type PurchasingStatusProps = {
  status?: (typeof purchaseOrderStatusType)[number] | null;
  /** The status as its icon alone, with the name in a tooltip. */
  iconOnly?: boolean;
};

const PurchasingStatus = ({ status, iconOnly }: PurchasingStatusProps) => {
  if (!status) return null;
  // Every status renders the same way; only its colour differs. An unknown
  // status (none today) has no colour and renders nothing, as before.
  const color = PURCHASE_ORDER_STATUS_COLOR_MAP[status];
  if (!color) return null;
  return (
    <Status color={color} iconOnly={iconOnly}>
      {status}
    </Status>
  );
};

export default PurchasingStatus;
