// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { draftLeaseSetupPath } from "~/modules/purchasing/purchasing.server";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import {
  LeaseAssetSummary,
  LeaseEvents,
  LeasePayments,
  LeaseSchedule
} from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

/** A Draft's assets are edited in its setup, so an editor is sent there, as
 *  from the lease page. An asset of another lease goes back to this one. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");
  const setup = await draftLeaseSetupPath(client, { companyId, userId, id });
  if (setup) throw redirect(setup);

  const line = await client
    .from("leaseLine")
    .select("id")
    .eq("id", lineId)
    .eq("leaseId", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (line.error || !line.data) {
    throw redirect(
      path.to.leaseDetails(id),
      await flash(request, error(line.error, "Failed to load the asset"))
    );
  }
  return null;
}

/** One asset of the lease: where it is in its lease and its actions, then
 *  its own payment rows, schedule and events. */
export default function LeaseLineRoute() {
  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  const line = routeData.lines.find((l) => l.id === lineId);
  if (!line) return null;

  const { lease, payments, schedule, events, journals, fixedAssets } =
    routeData;
  const ofLine = <T extends { leaseLineId: string }>(rows: T[]) =>
    rows.filter((row) => row.leaseLineId === line.id);

  return (
    <>
      <LeaseAssetSummary
        lease={lease}
        line={line}
        payments={payments}
        schedule={schedule}
        fixedAssets={fixedAssets}
      />
      <LeasePayments
        lease={lease}
        lines={[line]}
        payments={ofLine(payments)}
        paymentInvoices={routeData.paymentInvoices}
      />
      {lease.status !== "Draft" && (
        <>
          <LeaseSchedule
            lease={lease}
            lines={[line]}
            schedule={ofLine(schedule)}
            journals={journals}
          />
          <LeaseEvents
            lease={lease}
            lines={[line]}
            events={ofLine(events)}
            journals={journals}
            fixedAssets={fixedAssets}
          />
        </>
      )}
    </>
  );
}
