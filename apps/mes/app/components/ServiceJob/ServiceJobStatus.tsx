// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The service job's status, coverage and warranty, in the ERP's colors
// (`apps/erp/app/modules/service/ui/ServiceJob/ServiceJobStatus.tsx`,
// `CoverageBadge.tsx` and `ServiceStatus.tsx` `WarrantyBadge`).

import type { Database } from "@carbon/database";
import { Badge, Status } from "@carbon/react";
import {
  SERVICE_COVERAGE_COLOR_MAP,
  SERVICE_JOB_STATUS_COLOR_MAP,
  type WarrantyStatus,
  warrantyStatus
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";

type Enums = Database["public"]["Enums"];
type ServiceJobStatusType = Enums["serviceJobStatus"];
type ServiceCoverage = Enums["serviceCoverage"];
type ServiceWorkSite = Enums["serviceWorkSite"];

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

export function ServiceJobStatus({
  status,
  className
}: {
  status?: ServiceJobStatusType | null;
  className?: string;
}) {
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

export function useCoverageLabels(): Record<ServiceCoverage, string> {
  const { t } = useLingui();
  return {
    Billable: t`Billable`,
    Warranty: t`Warranty`,
    Contract: t`Contract`
  };
}

/** Who pays for a service job: the customer, the warranty, or a contract. */
export function CoverageBadge({
  coverage,
  className
}: {
  coverage?: ServiceCoverage | null;
  className?: string;
}) {
  const labels = useCoverageLabels();
  if (!coverage) return null;
  return (
    <Badge variant={SERVICE_COVERAGE_COLOR_MAP[coverage]} className={className}>
      {labels[coverage]}
    </Badge>
  );
}

export function useWorkSiteLabels(): Record<ServiceWorkSite, string> {
  const { t } = useLingui();
  return {
    Depot: t`Depot`,
    "Customer Site": t`Customer Site`
  };
}

const WARRANTY_BADGE_VARIANT: Record<
  WarrantyStatus,
  "green" | "yellow" | "gray"
> = {
  "In warranty": "green",
  "Labor ended": "yellow",
  Expired: "gray"
};

/**
 * The warranty of a customer asset on `today` (the company's day,
 * `YYYY-MM-DD`): In warranty while the labor warranty runs, Labor ended
 * while only the parts warranty runs, else Expired.
 */
export function WarrantyBadge({
  asset,
  today
}: {
  asset: {
    laborWarrantyEndDate: string | null;
    partsWarrantyEndDate: string | null;
  };
  today: string;
}) {
  const { t } = useLingui();
  const labels: Record<WarrantyStatus, string> = {
    "In warranty": t`In warranty`,
    "Labor ended": t`Labor ended`,
    Expired: t`Expired`
  };
  const status = warrantyStatus(asset, today);
  return (
    <Badge variant={WARRANTY_BADGE_VARIANT[status]}>{labels[status]}</Badge>
  );
}
