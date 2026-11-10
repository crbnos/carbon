// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { actionOutcome, useAction } from "@carbon/query";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { usePermissions } from "~/hooks";
import type { action as salesDimensionAction } from "~/routes/x+/sales-dimension-assignments";
import { path } from "~/utils/path";
import {
  type SalesCustomDimension,
  type SalesDimensionAssignment,
  SalesDimensionAssignments
} from "./SalesDimensionAssignments";

type RecordType = "customer" | "quote" | "salesOrder" | "salesInvoice" | "memo";

export function SalesDimensionAssignmentsPanel({
  recordType,
  recordId,
  availableDimensions,
  assignments: loadedAssignments,
  locked = false
}: {
  recordType: RecordType;
  recordId: string;
  availableDimensions: SalesCustomDimension[];
  assignments: SalesDimensionAssignment[];
  locked?: boolean;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [assignments, setAssignments] = useState(loadedAssignments);
  const action = useAction<typeof salesDimensionAction>({
    onSettled: (result) => {
      if (actionOutcome(result) === "error") setAssignments(loadedAssignments);
    }
  });

  useEffect(() => setAssignments(loadedAssignments), [loadedAssignments]);

  if (availableDimensions.length === 0) return null;

  const canEdit =
    !locked &&
    permissions.can(
      "update",
      recordType === "salesInvoice" || recordType === "memo"
        ? "invoicing"
        : "sales"
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t`Custom dimensions`}</CardTitle>
      </CardHeader>
      <CardContent>
        <SalesDimensionAssignments
          availableDimensions={availableDimensions}
          assignments={assignments}
          disabled={!canEdit || action.isPending}
          onChange={(next) => {
            setAssignments(next);
            action.submit(
              { recordType, recordId, assignments: next },
              {
                method: "post",
                encType: "application/json",
                action: path.to.salesDimensionAssignments
              }
            );
          }}
        />
      </CardContent>
    </Card>
  );
}
