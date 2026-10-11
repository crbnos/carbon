// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deleteLeasePayment, getLease } from "~/modules/purchasing";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id, paymentId } = params;
  if (!id) throw notFound("id not found");
  if (!paymentId) throw notFound("paymentId not found");

  const back = requestReferrer(request) ?? path.to.leaseDetails(id);

  const lease = await getLease(client, id, companyId);
  if (lease.error || lease.data?.companyId !== companyId) {
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Lease not found"))
    );
  }
  if (lease.data.status !== "Draft") {
    throw redirect(
      back,
      await flash(
        request,
        error(null, "Payment rows change only while the lease is Draft")
      )
    );
  }

  // Scoped to the URL's lease by the service's `leaseId` filter.
  const result = await deleteLeasePayment(client, {
    leaseId: id,
    paymentId,
    companyId
  });
  if (result.error) {
    throw redirect(
      back,
      await flash(request, error(result.error, "Failed to delete payment"))
    );
  }

  throw redirect(back, await flash(request, success("Deleted payment")));
}
