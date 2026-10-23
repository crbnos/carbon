// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, Status } from "@carbon/react";
import {
  BILLABLE_ITEM_STATUS_COLOR_MAP,
  CUSTOMER_ASSET_STATUS_COLOR_MAP
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useCompanyToday } from "~/hooks";
import type {
  CustomerAssetStatus as CustomerAssetStatusType,
  ProjectBillableItemStatus,
  WarrantyStatus
} from "../service.models";
import { warrantyStatus } from "../service.models";

export function CustomerAssetStatus({
  status
}: {
  status?: CustomerAssetStatusType | null;
}) {
  const { t } = useLingui();
  if (!status) return null;
  const labels: Record<CustomerAssetStatusType, string> = {
    "In Service": t`In Service`,
    "At Depot": t`At Depot`,
    Returned: t`Returned`
  };
  return (
    <Status color={CUSTOMER_ASSET_STATUS_COLOR_MAP[status]}>
      {labels[status]}
    </Status>
  );
}

export function useWarrantyStatusLabels(): Record<WarrantyStatus, string> {
  const { t } = useLingui();
  return {
    "In warranty": t`In warranty`,
    "Labor ended": t`Labor ended`,
    Expired: t`Expired`
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
 * The warranty of a customer asset on the company's today: In warranty while
 * the labor warranty runs, Labor ended while only the parts warranty runs,
 * else Expired.
 */
export function WarrantyBadge({
  asset
}: {
  asset: {
    laborWarrantyEndDate: string | null;
    partsWarrantyEndDate: string | null;
  };
}) {
  const today = useCompanyToday();
  const labels = useWarrantyStatusLabels();
  const status = warrantyStatus(asset, today);
  return (
    <Badge variant={WARRANTY_BADGE_VARIANT[status]}>{labels[status]}</Badge>
  );
}

export function useBillableItemStatusLabels(): Record<
  ProjectBillableItemStatus,
  string
> {
  const { t } = useLingui();
  return {
    Unbilled: t`Unbilled`,
    "On Hold": t`On Hold`,
    Billed: t`Billed`,
    "Written Off": t`Written Off`
  };
}

/** Where a billable item stands: waiting, held, invoiced or written off. */
export function BillableItemStatus({
  status
}: {
  status?: ProjectBillableItemStatus | null;
}) {
  const labels = useBillableItemStatusLabels();
  if (!status) return null;
  return (
    <Status color={BILLABLE_ITEM_STATUS_COLOR_MAP[status]}>
      {labels[status]}
    </Status>
  );
}
