// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { regenerateLeasePayments } from "~/modules/purchasing/purchasing.service";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "lease-payments-regenerate");

/** Cuts a Draft lease's payment rows again from its terms, replacing every
 *  row (edited, added or deleted ones included). The rows are rounded to
 *  the lease currency's decimal places inside `regenerateLeasePayments`. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const back = requestReferrer(request) ?? path.to.leaseDetails(id);

  // Refuses a lease that is not a Draft.
  try {
    await regenerateLeasePayments(getDatabaseClient(), {
      leaseId: id,
      companyId,
      userId
    });
  } catch (err) {
    logger.error("lease payment rows were not cut again", {
      companyId,
      leaseId: id,
      error: err
    });
    throw redirect(
      back,
      await flash(
        request,
        error(err, getErrorMessage(err, "Failed to regenerate the payments"))
      )
    );
  }

  throw redirect(
    back,
    await flash(request, success("Payments regenerated from the terms"))
  );
}
