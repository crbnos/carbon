// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

import { rentalAgreementReleaseValidator } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const formData = await request.formData();
  const validation = await validator(rentalAgreementReleaseValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // The line comes from the URL; the server function re-reads it under the
  // agreement and company, and refuses a unit that is not Pending, one
  // treated as a sale, or one on an open rental document.
  const result = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-rental-agreement", {
      type: "release",
      rentalAgreementId: id,
      rentalAgreementLineId: lineId,
      returnedAt: validation.data.returnedAt
    });

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to release the unit")
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
    await flash(request, success("Unit released"))
  );
}
