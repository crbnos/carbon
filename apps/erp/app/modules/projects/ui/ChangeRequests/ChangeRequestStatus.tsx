// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { PROJECT_CHANGE_REQUEST_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ProjectChangeRequestStatus } from "../../projects.models";

const ChangeRequestStatus = ({
  status
}: {
  status?: ProjectChangeRequestStatus | null;
}) => {
  const { t } = useLingui();
  if (!status) return null;

  const labels: Record<ProjectChangeRequestStatus, string> = {
    Draft: t`Draft`,
    "In Review": t`In Review`,
    Approved: t`Approved`,
    Applied: t`Applied`,
    Rejected: t`Rejected`,
    Cancelled: t`Cancelled`
  };

  return (
    <Status color={PROJECT_CHANGE_REQUEST_STATUS_COLOR_MAP[status]}>
      {labels[status] ?? status}
    </Status>
  );
};

export default ChangeRequestStatus;
