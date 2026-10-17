// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recalculateQuoteLinePrices } from "~/modules/sales";
import { requireCompanyRecord } from "~/modules/shared/shared.server";

// Deletes one or more materials of the quote line: the form carries an `id`
// per material, so the bill of material's "Delete Selected" is a single request and
// the line's prices are recalculated once.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) {
    throw new Error("quoteId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const formData = await request.formData();
  const ids = formData.getAll("id").map(String).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("id not found");
  }

  // The price recalculation below uses the service role: the line must belong
  // to this company before anything is touched, and the delete is scoped to it.
  const serviceRole = getCarbonServiceRole();
  await requireCompanyRecord(serviceRole, "quoteLine", companyId, {
    id: lineId,
    quoteId
  });

  const deleteMaterials = await client
    .from("quoteMaterial")
    .delete()
    .in("id", ids)
    .eq("quoteLineId", lineId)
    .eq("companyId", companyId);
  if (deleteMaterials.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteMaterials.error, "Failed to delete quote material")
      )
    );
  }

  await recalculateQuoteLinePrices(
    serviceRole,
    companyId,
    quoteId,
    lineId,
    userId
  );

  return {};
}
