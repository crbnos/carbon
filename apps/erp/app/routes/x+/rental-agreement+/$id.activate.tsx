// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

import { getRentalAgreement } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
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

  if (agreement.data.status !== "Draft") {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "Only a Draft rental agreement can be activated")
      )
    );
  }

  if (!agreement.data.lineCount) {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(request, error(null, "Add a unit before activating"))
    );
  }

  // Validates every unit, snapshots the rate ladder, classifies each line and
  // cuts the first billing periods — one transaction in the server function.
  const result = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-rental-agreement", {
      type: "activate",
      rentalAgreementId: id
    });

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to activate rental agreement")
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
    await flash(request, success("Rental agreement activated"))
  );
}
