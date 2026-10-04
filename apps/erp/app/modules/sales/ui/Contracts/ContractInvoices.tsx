// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Empty } from "~/components";
import type { ContractRouteData } from "./types";

type ContractInvoicesProps = Pick<
  ContractRouteData,
  | "contract"
  | "lines"
  | "schedule"
  | "credits"
  | "computedSchedule"
  | "residuals"
>;

/** The invoice schedule, editable while Draft (Task 25). Placeholder until its task builds the body. */
const ContractInvoices = (_props: ContractInvoicesProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Invoices</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Empty className="py-8" />
      </CardContent>
    </Card>
  );
};

export default ContractInvoices;
