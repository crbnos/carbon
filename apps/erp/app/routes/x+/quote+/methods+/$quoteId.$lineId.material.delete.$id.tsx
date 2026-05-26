import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteQuoteMaterial,
  recalculateQuoteLinePrices
} from "~/modules/sales/sales.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "sales"
  });

  const { quoteId, lineId, id } = params;
  if (!quoteId) {
    throw new Error("quoteId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }
  if (!id) {
    throw new Error("id not found");
  }

  const deleteMaterial = await deleteQuoteMaterial(id);
  if (deleteMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteMaterial.error, "Failed to delete quote material")
      )
    );
  }

  await recalculateQuoteLinePrices(quoteId, lineId);

  return {};
}
