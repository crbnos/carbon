// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { warehouseTransferStatusType } from "../../inventory.models";

type Props = {
  status: (typeof warehouseTransferStatusType)[number];
};

const WarehouseTransferStatus = ({ status }: Props) => {
  switch (status) {
    case "Draft":
      return (
        <Badge variant="secondary">
          <Trans>Draft</Trans>
        </Badge>
      );
    case "To Ship and Receive":
      return (
        <Badge variant="yellow">
          <Trans>To Ship and Receive</Trans>
        </Badge>
      );
    case "To Ship":
      return (
        <Badge variant="blue">
          <Trans>To Ship</Trans>
        </Badge>
      );
    case "To Receive":
      return (
        <Badge variant="blue">
          <Trans>To Receive</Trans>
        </Badge>
      );
    case "Completed":
      return (
        <Badge variant="green">
          <Trans>Completed</Trans>
        </Badge>
      );
    case "Cancelled":
      return (
        <Badge variant="destructive">
          <Trans>Cancelled</Trans>
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
};

export default WarehouseTransferStatus;
