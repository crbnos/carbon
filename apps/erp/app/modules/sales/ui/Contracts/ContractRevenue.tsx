// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Empty } from "~/components";
import type { ContractRouteData } from "./types";

type ContractRevenueProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "revenue"
>;

/** Each line's revenue by month and the invoiced / recognized / deferred position — a preview (Task 26). Placeholder until its task builds the body. */
const ContractRevenue = (_props: ContractRevenueProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Revenue</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Empty className="py-8" />
      </CardContent>
    </Card>
  );
};

export default ContractRevenue;
