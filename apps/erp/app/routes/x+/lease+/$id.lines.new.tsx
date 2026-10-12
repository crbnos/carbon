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
import { leaseLineValidator, upsertLeaseLine } from "~/modules/purchasing";
import { regenerateLeasePayments } from "~/modules/purchasing/purchasing.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "lease-line-new");

/** Adds an asset to a Draft lease (the setup wizard's Add Asset) and cuts
 *  its payment rows from the lease's terms. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(leaseLineValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const back = requestReferrer(request) ?? path.to.leaseSetup(id, "assets");

  // Refuses a lease that is not a Draft.
  const { id: _id, leaseId: _leaseId, ...line } = validation.data;
  const insert = await upsertLeaseLine(client, {
    ...line,
    leaseId: id,
    companyId,
    userId
  });
  if (insert.error || !insert.data) {
    throw redirect(
      back,
      await flash(
        request,
        error(insert.error, insert.error?.message || "Failed to add the asset")
      )
    );
  }

  try {
    await regenerateLeasePayments(getDatabaseClient(), {
      leaseId: id,
      leaseLineId: insert.data.id,
      companyId,
      userId
    });
  } catch (err) {
    logger.error("lease payment rows for a new asset failed", {
      companyId,
      leaseId: id,
      error: err
    });
    throw redirect(
      back,
      await flash(
        request,
        error(err, "Added the asset, but its payment rows were not cut")
      )
    );
  }

  throw redirect(back, await flash(request, success("Added asset")));
}
