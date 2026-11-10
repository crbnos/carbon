// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deleteLeaseLine } from "~/modules/purchasing/purchasing.service";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "lease-line-delete");

/** Removes an asset, with its payment rows, from a Draft lease. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const back = requestReferrer(request) ?? path.to.leaseSetup(id, "assets");

  // Refuses a lease that is not a Draft.
  const result = await deleteLeaseLine(client, {
    leaseId: id,
    leaseLineId: lineId,
    companyId
  });
  if (result.error) {
    logger.error("lease asset was not removed", {
      companyId,
      leaseId: id,
      leaseLineId: lineId,
      error: result.error
    });
    throw redirect(
      back,
      await flash(
        request,
        error(result.error, result.error.message || "Failed to remove asset")
      )
    );
  }

  throw redirect(
    back,
    await flash(request, success("Removed asset from the lease"))
  );
}
