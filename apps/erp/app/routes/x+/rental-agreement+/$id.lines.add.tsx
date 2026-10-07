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
  getRentalAgreement,
  insertRentalAgreementLines,
  rentalAgreementLinesAddValidator
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

/** Adds the chosen fleet units to a Draft agreement (the setup wizard's Add
 *  Units), each at its rate on file for the chosen frequency. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const agreement = await getRentalAgreement(client, id, companyId);
  if (agreement.error || agreement.data?.companyId !== companyId) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(request, error(agreement.error, "Rental agreement not found"))
    );
  }

  const validation = await validator(rentalAgreementLinesAddValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const back = requestReferrer(request) ?? path.to.rentalAgreementDetails(id);

  // Refuses an agreement that is not a Draft and a unit with no item.
  const insert = await insertRentalAgreementLines(client, {
    rentalAgreementId: id,
    companyId,
    createdBy: userId,
    fixedAssetIds: validation.data.fixedAssetIds,
    rateUnit: validation.data.rateUnit
  });

  if (insert.error) {
    throw redirect(
      back,
      await flash(
        request,
        error(insert.error, insert.error.message || "Failed to add units")
      )
    );
  }

  throw redirect(
    back,
    await flash(
      request,
      success(
        insert.data.length === 1
          ? "Added 1 unit to the agreement"
          : `Added ${insert.data.length} units to the agreement`
      )
    )
  );
}
