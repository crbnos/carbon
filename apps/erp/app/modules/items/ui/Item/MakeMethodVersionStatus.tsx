// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type MakeMethodVersionStatusProps = {
  status?: Database["public"]["Enums"]["makeMethodStatus"];
  isActive?: boolean;
};

const MakeMethodVersionStatus = ({
  status,
  isActive
}: MakeMethodVersionStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "Active":
      return (
        <Status color="green">
          <Trans>Active</Trans>
        </Status>
      );
    case "Archived":
      return (
        <Status color="orange">
          <Trans>Archived</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default MakeMethodVersionStatus;
