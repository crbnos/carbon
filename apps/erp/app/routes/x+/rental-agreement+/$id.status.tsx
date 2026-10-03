// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getRentalAgreement } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "close" && intent !== "cancel") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, error(null, "Invalid status change"))
    );
  }

  const agreement = await getRentalAgreement(client, id);
  if (agreement.error || agreement.data?.companyId !== companyId) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(request, error(agreement.error, "Rental agreement not found"))
    );
  }

  // The edge function owns the guards: close needs every unit back and every
  // period invoiced; cancel needs no unit on rent and no invoiced period.
  const result = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-rental-agreement", {
      type: intent,
      rentalAgreementId: id
    });

  if (result.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(
            result.error,
            intent === "close"
              ? "Failed to close rental agreement"
              : "Failed to cancel rental agreement"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(
      request,
      success(
        intent === "close"
          ? "Rental agreement closed"
          : "Rental agreement cancelled"
      )
    )
  );
}
