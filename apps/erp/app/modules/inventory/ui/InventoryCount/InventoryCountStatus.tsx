// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { RECEIPT_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";

type InventoryCountStatusProps = {
  status?: Database["public"]["Enums"]["inventoryCountStatus"];
};

// Inventory Count shares the Draft / Pending / Posted lifecycle (and therefore
// the colors) with receipts and shipments.
const InventoryCountStatus = ({ status }: InventoryCountStatusProps) => {
  if (!status) return null;
  const color = RECEIPT_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Draft":
      return (
        <Status color={color}>
          <Trans>Draft</Trans>
        </Status>
      );
    case "Pending":
      return (
        <Status color={color}>
          <Trans>Pending</Trans>
        </Status>
      );
    case "Posted":
      return (
        <Status color={color}>
          <Trans>Posted</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default InventoryCountStatus;
