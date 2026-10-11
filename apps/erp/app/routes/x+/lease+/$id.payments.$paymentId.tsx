// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  getLease,
  leasePaymentValidator,
  upsertLeasePayment
} from "~/modules/purchasing";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id, paymentId } = params;
  if (!id) throw notFound("id not found");
  if (!paymentId) throw notFound("paymentId not found");

  const formData = await request.formData();
  const validation = await validator(leasePaymentValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const back = requestReferrer(request) ?? path.to.leaseDetails(id);

  const [lease, existing] = await Promise.all([
    getLease(client, id, companyId),
    // The row must belong to the URL's lease.
    client
      .from("leasePayment")
      .select("id")
      .eq("id", paymentId)
      .eq("leaseId", id)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (lease.error || lease.data?.companyId !== companyId) {
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Lease not found"))
    );
  }
  if (existing.error || !existing.data) {
    throw redirect(
      back,
      await flash(
        request,
        error(existing.error, "This payment does not belong to this lease")
      )
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

  const { id: _id, leaseId: _leaseId, ...payment } = validation.data;
  const update = await upsertLeasePayment(client, {
    ...payment,
    id: paymentId,
    leaseId: id,
    companyId,
    userId
  });
  if (update.error) {
    throw redirect(
      back,
      await flash(request, error(update.error, "Failed to update payment"))
    );
  }

  throw redirect(back, await flash(request, success("Updated payment")));
}
