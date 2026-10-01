// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type RevenueRecognitionRunStatusProps = {
  status?: string | null;
};

const RevenueRecognitionRunStatus = ({
  status
}: RevenueRecognitionRunStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "Posted":
      return (
        <Status color="green">
          <Trans>Posted</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default RevenueRecognitionRunStatus;
