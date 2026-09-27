import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteQuoteMaterial,
  recalculateQuoteLinePrices
} from "~/modules/sales";
import { requireCompanyRecord } from "~/modules/shared/shared.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  // The price recalculation below uses the service role: the material and its
  // line must belong to this company before anything is touched.
  const serviceRole = getCarbonServiceRole();
  await Promise.all([
    requireCompanyRecord(serviceRole, "quoteLine", companyId, {
      id: lineId,
      quoteId
    }),
    requireCompanyRecord(serviceRole, "quoteMaterial", companyId, {
      id,
      quoteLineId: lineId
    })
  ]);

  const deleteMaterial = await deleteQuoteMaterial(client, id);
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

  await recalculateQuoteLinePrices(
    serviceRole,
    companyId,
    quoteId,
    lineId,
    userId
  );

  return {};
}
