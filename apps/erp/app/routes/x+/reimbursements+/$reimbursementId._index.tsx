// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComponentProps } from "react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  type DimensionWithValues,
  ReimbursementSummary
} from "~/modules/invoicing";
import { path } from "~/utils/path";

type SummaryProps = ComponentProps<typeof ReimbursementSummary>;

/**
 * Read mode. The document is loaded once by the page
 * (`$reimbursementId.tsx`); its header owns Post, Pay expense and Void.
 */
export default function ReimbursementDetailRoute() {
  const { reimbursementId } = useParams();
  if (!reimbursementId) throw new Error("Could not find reimbursementId");

  const routeData = useRouteData<
    Omit<SummaryProps, "availableDimensions"> & {
      dimensions: DimensionWithValues[];
    }
  >(path.to.reimbursement(reimbursementId));

  if (!routeData?.reimbursement) {
    throw new Error("Could not find reimbursement in routeData");
  }

  return (
    <ReimbursementSummary
      reimbursement={routeData.reimbursement}
      lines={routeData.lines}
      accountsById={routeData.accountsById}
      mapping={routeData.mapping}
      availableDimensions={routeData.dimensions}
    />
  );
}
