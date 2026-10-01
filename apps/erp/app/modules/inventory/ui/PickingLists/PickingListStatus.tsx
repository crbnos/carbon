// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { pickingListStatusType } from "../../inventory.models";

type Props = {
  status: (typeof pickingListStatusType)[number];
};

const PickingListStatus = ({ status }: Props) => {
  switch (status) {
    case "Draft":
      return (
        <Badge variant="secondary">
          <Trans>Draft</Trans>
        </Badge>
      );
    case "In Progress":
      return (
        <Badge variant="blue">
          <Trans>In Progress</Trans>
        </Badge>
      );
    case "Completed":
      return (
        <Badge variant="green">
          <Trans>Completed</Trans>
        </Badge>
      );
    case "Partial":
      return (
        <Badge variant="orange">
          <Trans>Partial</Trans>
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

export default PickingListStatus;
