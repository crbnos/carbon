// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getRentalAgreementLine,
  rentalAgreementReturnValidator
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const formData = await request.formData();
  const validation = await validator(rentalAgreementReturnValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    meterIn,
    returnNotes,
    takeOutOfService,
    outOfServiceReason,
    residualDestination
  } = validation.data;

  // The posted `isSalesType` only drives the form; the line decides. A
  // Sale line's closing net investment must land somewhere.
  const line = await getRentalAgreementLine(client, lineId);
  if (line.error || line.data.rentalAgreementId !== id) {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "This unit does not belong to this rental agreement")
      )
    );
  }
  const isSalesType = line.data.lessorClassification === "Sale";
  if (isSalesType && !residualDestination) {
    return validationError({
      fieldErrors: {
        residualDestination: "Choose where the returned unit goes"
      }
    });
  }

  // The line comes from the URL; the edge function re-reads it under the
  // agreement and company before touching anything.
  const result = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-rental-agreement", {
      type: "return",
      rentalAgreementId: id,
      rentalAgreementLineId: lineId,
      returnedAt: validation.data.returnedAt,
      meterIn: meterIn ?? null,
      returnNotes: returnNotes ?? null,
      takeOutOfService,
      outOfServiceReason: takeOutOfService
        ? (outOfServiceReason ?? null)
        : null,
      ...(isSalesType ? { residualDestination } : {})
    });

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to return the unit")
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
    await flash(request, success("Unit returned"))
  );
}
