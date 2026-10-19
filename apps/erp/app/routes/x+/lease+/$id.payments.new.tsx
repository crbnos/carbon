// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { leasePaymentValidator } from "~/modules/purchasing/purchasing.models";
import { upsertLeasePayment } from "~/modules/purchasing/purchasing.service";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "lease-payment-new");

/** Adds a payment row to a Draft lease's asset (a rent holiday, an irregular
 *  step). `upsertLeasePayment` refuses a lease that is not a Draft. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(leasePaymentValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const back = requestReferrer(request) ?? path.to.leaseDetails(id);

  const { id: _id, leaseId: _leaseId, ...payment } = validation.data;
  const insert = await upsertLeasePayment(client, {
    ...payment,
    leaseId: id,
    companyId,
    userId
  });
  if (insert.error) {
    logger.error("lease payment was not added", {
      companyId,
      leaseId: id,
      error: insert.error
    });
    throw redirect(
      back,
      await flash(
        request,
        error(insert.error, insert.error.message || "Failed to add payment")
      )
    );
  }

  throw redirect(back, await flash(request, success("Added payment")));
}
