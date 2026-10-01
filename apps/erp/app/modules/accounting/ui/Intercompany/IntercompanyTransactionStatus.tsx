// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { intercompanyTransactionStatuses } from "../../accounting.models";

type IntercompanyTransactionStatusProps = {
  status?: (typeof intercompanyTransactionStatuses)[number] | null;
};

const IntercompanyTransactionStatus = ({
  status
}: IntercompanyTransactionStatusProps) => {
  switch (status) {
    case "Unmatched":
      return (
        <Status color="orange">
          <Trans>Unmatched</Trans>
        </Status>
      );
    case "Matched":
      return (
        <Status color="green">
          <Trans>Matched</Trans>
        </Status>
      );
    case "Eliminated":
      return (
        <Status color="gray">
          <Trans>Eliminated</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default IntercompanyTransactionStatus;
