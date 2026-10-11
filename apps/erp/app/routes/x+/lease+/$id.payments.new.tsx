// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
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

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(leasePaymentValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

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

  const { id: _id, leaseId: _leaseId, ...payment } = validation.data;
  const insert = await upsertLeasePayment(client, {
    ...payment,
    leaseId: id,
    companyId,
    userId
  });
  if (insert.error) {
    throw redirect(
      back,
      await flash(request, error(insert.error, "Failed to add payment"))
    );
  }

  throw redirect(back, await flash(request, success("Added payment")));
}
