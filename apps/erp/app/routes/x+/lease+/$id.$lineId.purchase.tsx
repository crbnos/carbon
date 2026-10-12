// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getLease, leasePurchaseValidator } from "~/modules/purchasing";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id, lineId } = params;
  if (!id || !lineId) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(leasePurchaseValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const lease = await getLease(client, id, companyId);
  if (lease.error || lease.data?.companyId !== companyId) {
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Lease not found"))
    );
  }

  // Derecognizes the right-of-use asset into a new fixed asset — one
  // transaction in the server function.
  const result = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-lease", {
      type: "purchase",
      leaseId: id,
      leaseLineId: lineId,
      exerciseDate: validation.data.exerciseDate,
      purchasePrice: validation.data.purchasePrice,
      fixedAssetClassId: validation.data.fixedAssetClassId,
      name: validation.data.name,
      notes: validation.data.notes ?? null
    });

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.leaseDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to purchase the leased asset")
        )
      )
    );
  }

  throw redirect(
    path.to.leaseLine(id, lineId),
    await flash(request, success("Purchase option exercised"))
  );
}
