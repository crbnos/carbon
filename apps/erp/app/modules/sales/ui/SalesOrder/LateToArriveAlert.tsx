// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { LuTruck } from "react-icons/lu";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";

type ShipByPlan = {
  arriveBy: string | null;
  lines: {
    id: string;
    promisedDate: string | null;
    estimatedArrival: string | null;
    lateToArrive: boolean;
  }[];
};

/**
 * The saved line ships too late for its transit days to reach the order's
 * promised arrival date. It reads the server's plan, so it shows the saved
 * ship-by date: a date typed in the form shows once the line is saved.
 */
export function LateToArriveAlert({
  orderId,
  lineId,
  promisedDate
}: {
  orderId: string;
  lineId?: string;
  promisedDate?: string | null;
}) {
  const { locale } = useLocale();
  const routeData = useRouteData<{ shipByPlan: ShipByPlan | null }>(
    path.to.salesOrder(orderId)
  );
  const plan = routeData?.shipByPlan;
  const entry = lineId
    ? plan?.lines.find((line) => line.id === lineId)
    : undefined;
  if (!plan || !entry?.lateToArrive) return null;
  if ((promisedDate ?? "") !== (entry.promisedDate ?? "")) return null;

  const estimated = formatDate(entry.estimatedArrival, undefined, locale);
  const promised = formatDate(plan.arriveBy, undefined, locale);
  return (
    <Alert variant="warning">
      <LuTruck className="h-4 w-4" />
      <AlertTitle>
        <Trans>Late to arrive</Trans>
      </AlertTitle>
      <AlertDescription>
        <Trans>
          Shipped on this date, the line arrives about {estimated}. The order is
          promised to arrive by {promised}.
        </Trans>
      </AlertDescription>
    </Alert>
  );
}
