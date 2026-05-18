import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { type ActionFunctionArgs, redirect } from "react-router";
import {
  deletePurchasingRFQLine,
  getPurchasingRFQ,
  isRfqLocked
} from "~/modules/purchasing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });
  await requirePermissions(request, {
    delete: "purchasing"
  });

  const { rfqId, lineId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const rfq = await getPurchasingRFQ(viewClient, rfqId);
  await requireUnlocked({
    request,
    isLocked: isRfqLocked(rfq.data?.status),
    redirectTo: path.to.purchasingRfq(rfqId),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  const deleteLine = await deletePurchasingRFQLine(lineId);
  if (deleteLine.error) {
    throw redirect(
      path.to.purchasingRfqLine(rfqId, lineId),
      await flash(request, error(deleteLine.error, "Failed to delete RFQ line"))
    );
  }

  throw redirect(path.to.purchasingRfq(rfqId));
}
