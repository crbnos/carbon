import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { consumePunchoutCart } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { create: "purchasing" });

  const sessionId = params.sessionId;
  if (!sessionId) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(request, error("Missing punchout session"))
    );
  }

  const result = await consumePunchoutCart(client, {
    sessionId,
    companyId,
    userId,
    companyGroupId
  });
  if (result.error || !result.data) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(result.error, "Failed to import McMaster-Carr cart")
      )
    );
  }

  const issueCount = result.data.issues.length;
  const message =
    issueCount > 0
      ? `Cart imported — ${issueCount} line${issueCount === 1 ? "" : "s"} could not be matched; review the G/L lines`
      : "Cart imported from McMaster-Carr";

  throw redirect(
    path.to.purchaseOrder(result.data.purchaseOrderId),
    await flash(request, success(message))
  );
}
