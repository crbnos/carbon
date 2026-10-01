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
  const color = PURCHASE_ORDER_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Draft":
      return (
        <Status color={color} iconOnly={iconOnly}>
          {status}
        </Status>
      );
    case "Planned":
    case "To Review":
    case "Needs Approval":
      return (
        <Status color={color} iconOnly={iconOnly}>
          {status}
        </Status>
      );
    case "To Receive":
    case "To Receive and Invoice":
      return (
        <Status color={color} iconOnly={iconOnly}>
          {status}
        </Status>
      );
    case "To Invoice":
      return (
        <Status color={color} iconOnly={iconOnly}>
          {status}
        </Status>
      );
    case "Completed":
      return (
        <Status color={color} iconOnly={iconOnly}>
          {status}
        </Status>
      );
    case "Closed":
    case "Rejected":
      return (
        <Status color={color} iconOnly={iconOnly}>
          {status}
        </Status>
      );
    default:
      return null;
  }
};

export default PurchasingStatus;
