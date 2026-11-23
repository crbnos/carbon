// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { SERVICE_JOB_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ServiceJobStatus as ServiceJobStatusType } from "../../service.models";

export function useServiceJobStatusLabels(): Record<
  ServiceJobStatusType,
  string
> {
  const { t } = useLingui();
  return {
    Open: t`Open`,
    "Awaiting Approval": t`Awaiting Approval`,
    "In Progress": t`In Progress`,
    "On Hold": t`On Hold`,
    Completed: t`Completed`,
    Invoiced: t`Invoiced`,
    Cancelled: t`Cancelled`
  };
}

type ServiceJobStatusProps = {
  status?: ServiceJobStatusType | null;
  className?: string;
};

function ServiceJobStatus({ status, className }: ServiceJobStatusProps) {
  const labels = useServiceJobStatusLabels();
  if (!status) return null;
  const color = SERVICE_JOB_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return (
    <Status color={color} className={className}>
      {labels[status]}
    </Status>
  );
}

export default ServiceJobStatus;
