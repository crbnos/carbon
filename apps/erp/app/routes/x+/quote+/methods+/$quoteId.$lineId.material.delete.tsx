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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
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
  const ids = formData.getAll("ids").map(String).filter(Boolean);

  if (ids.length === 0) {
    return data({ error: "Material IDs are required" }, { status: 400 });
  }

  const deleteMaterials = await deleteQuoteMaterial(client, ids);
  if (deleteMaterials.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteMaterials.error, "Failed to delete quote materials")
      )
    );
  }

  const serviceRole = getCarbonServiceRole();
  await recalculateQuoteLinePrices(serviceRole, quoteId, lineId, userId);

  return {};
}
