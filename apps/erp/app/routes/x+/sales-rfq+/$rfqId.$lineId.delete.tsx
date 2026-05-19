import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deleteSalesRFQLine,
  getSalesRFQ,
  isSalesRfqLocked
} from "~/modules/sales";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { rfqId, lineId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  await requirePermissions(request, {
    view: "sales"
  });

  const rfq = await getSalesRFQ(rfqId);
  await requireUnlocked({
    request,
    isLocked: isSalesRfqLocked(rfq.data?.status),
    redirectTo: path.to.salesRfq(rfqId),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  await requirePermissions(request, {
    delete: "sales"
  });

  const deleteLine = await deleteSalesRFQLine(lineId);
  if (deleteLine.error) {
    throw redirect(
      path.to.quoteLine(rfqId, lineId),
      await flash(
        request,
        error(deleteLine.error, "Failed to update quote line")
      )
    );
  }

  throw redirect(path.to.salesRfq(rfqId));
}
