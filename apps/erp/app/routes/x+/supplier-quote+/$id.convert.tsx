// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { selectedLinesValidator } from "~/modules/purchasing/purchasing.models";
import { path } from "~/utils/path";

const logger = getLogger("erp", "id-convert");

/** `purchasing.convertSupplierQuoteToOrder` holds the gate and the supplier-approval check. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const selectedLinesRaw = formData.get("selectedLines") ?? "{}";

  if (typeof selectedLinesRaw !== "string") {
    throw redirect(
      path.to.supplierQuoteDetails(id),
      await flash(request, error(null, "Invalid selected lines data"))
    );
  }

  const parseResult = selectedLinesValidator.safeParse(
    JSON.parse(selectedLinesRaw)
  );

  if (!parseResult.success) {
    logger.error("Validation error:", parseResult.error);
    throw redirect(
      path.to.supplierQuoteDetails(id),
      await flash(request, error(null, "Invalid selected lines data"))
    );
  }

  const { api } = await authorize(request);
  const result = await api.purchasing.convertSupplierQuoteToOrder({
    id,
    selectedLines: parseResult.data
  });

  return respond(request, result).redirect(
    result.data?.convertedId
      ? path.to.purchaseOrder(result.data.convertedId)
      : path.to.supplierQuoteDetails(id),
    { message: "Successfully converted quote to order" }
  );
}
