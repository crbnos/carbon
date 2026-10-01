// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { salesReturnOrderStatusType } from "../../sales.models";

type SalesReturnOrderStatusProps = {
  status?: (typeof salesReturnOrderStatusType)[number] | null;
};

const SalesReturnOrderStatus = ({ status }: SalesReturnOrderStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "To Receive":
      return (
        <Status color="blue">
          <Trans>To Receive</Trans>
        </Status>
      );
    case "Completed":
      return (
        <Status color="green">
          <Trans>Completed</Trans>
        </Status>
      );
    case "Cancelled":
      return (
        <Status color="red">
          <Trans>Cancelled</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default SalesReturnOrderStatus;
