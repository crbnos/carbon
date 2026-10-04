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
  rentalAgreementLineValidator,
  upsertRentalAgreementLine
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const agreement = await getRentalAgreement(client, id);
  if (agreement.error || agreement.data?.companyId !== companyId) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(request, error(agreement.error, "Rental agreement not found"))
    );
  }
  if (agreement.data.status !== "Draft") {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "Units can only be added to a Draft rental agreement")
      )
    );
  }

  const formData = await request.formData();
  const validation = await validator(rentalAgreementLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, itemId: _itemId, ...line } = validation.data;

  const insert = await upsertRentalAgreementLine(client, {
    ...line,
    // The agreement checked above is the URL's — never the form's copy.
    rentalAgreementId: id,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(insert.error, insert.error.message || "Failed to add unit")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
    await flash(request, success("Added unit to the agreement"))
  );
}
