import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { type ActionFunctionArgs, redirect } from "react-router";
import { deletePurchasingRFQLine } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { rfqId, lineId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const deleteLine = await deletePurchasingRFQLine(client, lineId);
  if (deleteLine.error) {
    throw redirect(
      path.to.purchasingRfqLine(rfqId, lineId),
      await flash(request, error(deleteLine.error, "Failed to delete RFQ line"))
    );
  }

  throw redirect(path.to.purchasingRfq(rfqId));
}
