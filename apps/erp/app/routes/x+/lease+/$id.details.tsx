// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { draftLeaseSetupPath } from "~/modules/purchasing/purchasing.server";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import {
  LeaseClassificationPreview,
  LeaseEvents,
  LeasePayments,
  LeaseSummary
} from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

/** A Draft is worked on in its setup wizard, so its page sends an editor
 *  there — including every action that returns to the lease page. A viewer
 *  who cannot edit sees the page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const setup = await draftLeaseSetupPath(client, { companyId, userId, id });
  if (setup) throw redirect(setup);
  return null;
}

/** The lease as a whole: its summary, how its assets will be accounted for
 *  while Draft (seen here only by a viewer; an editor works in the setup),
 *  every payment row and every event. The terms are in the properties panel;
 *  an asset's own page is `$lineId.details`, opened from the explorer. */
export default function LeaseDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  const {
    lease,
    lines,
    payments,
    schedule,
    events,
    journals,
    paymentInvoices,
    fixedAssets,
    leasePolicy
  } = routeData;

  return (
    <>
      <LeaseSummary
        lease={lease}
        lines={lines}
        payments={payments}
        schedule={schedule}
      />
      {lease.status === "Draft" && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Accounting Treatment</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Decided for each asset when the lease is activated, from its
                payment rows and its classification inputs.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeaseClassificationPreview
              lease={lease}
              lines={lines}
              payments={payments}
              policy={leasePolicy}
            />
          </CardContent>
        </Card>
      )}
      <LeasePayments
        lease={lease}
        lines={lines}
        payments={payments}
        paymentInvoices={paymentInvoices}
      />
      {lease.status !== "Draft" && (
        <LeaseEvents
          lease={lease}
          lines={lines}
          events={events}
          journals={journals}
          fixedAssets={fixedAssets}
        />
      )}
    </>
  );
}
