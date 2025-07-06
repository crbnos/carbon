import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { salesOrderToJobsTask } from "@carbon/jobs/trigger/sales-order-to-jobs";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path, requestReferrer } from "~/utils/path";

export const config = { runtime: "nodejs" };

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId } = params;
  if (!orderId) {
    throw new Error("Invalid orderId");
  }

  const { companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  await tasks.trigger<typeof salesOrderToJobsTask>("sales-order-to-jobs", {
    orderId,
    companyId,
    userId,
  });

  throw redirect(
    requestReferrer(request) ?? path.to.salesOrder(orderId),
    await flash(request, success("Jobs queued for creation"))
  );
}
