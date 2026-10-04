// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Empty } from "~/components";
import type { ContractRouteData } from "./types";

type ContractSummaryProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "schedule" | "computedSchedule"
>;

/** The lines as line items, the contract value, recurring value per period and next invoice (Task 24). Placeholder until its task builds the body. */
const ContractSummary = (_props: ContractSummaryProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Summary</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Empty className="py-8" />
      </CardContent>
    </Card>
  );
};

export default ContractSummary;
