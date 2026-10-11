// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import {
  LeaseClassificationPreview,
  LeasePayments,
  LeaseSummary
} from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

/** The lease as a whole: its summary, how it will be accounted for while
 *  Draft, and its payment rows. The terms are in the properties panel. */
export default function LeaseDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  const { lease, payments, schedule, paymentInvoices, leasePolicy } = routeData;

  return (
    <>
      <LeaseSummary lease={lease} payments={payments} schedule={schedule} />
      {lease.status === "Draft" && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Accounting Treatment</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Decided when the lease is activated, from the payment rows and
                the classification inputs.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeaseClassificationPreview
              lease={lease}
              payments={payments}
              policy={leasePolicy}
            />
          </CardContent>
        </Card>
      )}
      <LeasePayments
        lease={lease}
        payments={payments}
        paymentInvoices={paymentInvoices}
      />
    </>
  );
}
