import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { deleteSalesRFQLine } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { rfqId, lineId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const deleteLine = await deleteSalesRFQLine(client, lineId);
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
