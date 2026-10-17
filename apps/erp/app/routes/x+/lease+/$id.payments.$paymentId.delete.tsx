// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deleteLeasePayment } from "~/modules/purchasing/purchasing.service";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "lease-payment-delete");

/** Deletes a payment row of a Draft lease. `deleteLeasePayment` refuses a
 *  lease that is not a Draft, and a row that is not on this lease. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { id, paymentId } = params;
  if (!id) throw notFound("id not found");
  if (!paymentId) throw notFound("paymentId not found");

  const back = requestReferrer(request) ?? path.to.leaseDetails(id);

  const result = await deleteLeasePayment(client, {
    leaseId: id,
    paymentId,
    companyId
  });
  if (result.error) {
    logger.error("lease payment was not deleted", {
      companyId,
      leaseId: id,
      paymentId,
      error: result.error
    });
    throw redirect(
      back,
      await flash(
        request,
        error(result.error, result.error.message || "Failed to delete payment")
      )
    );
  }

  throw redirect(back, await flash(request, success("Deleted payment")));
}
