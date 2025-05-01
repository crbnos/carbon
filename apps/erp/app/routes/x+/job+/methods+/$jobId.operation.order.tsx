import { json, type ActionFunctionArgs } from "@vercel/remix";

import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  recalculateJobOperationDependencies,
  updateJobOperationOrder,
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
  });

  const formData = await request.formData();
  const updateMap = formData.get("updates") as string;

  const { jobId } = params;
  if (!jobId) {
    return json(
      {},
      await flash(request, error(null, "Failed to receive a job id"))
    );
  }

  if (!updateMap) {
    return json(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, orderString]) => ({
      id,
      order: Number(orderString),
      updatedBy: userId,
    })
  );

  const updateSortOrders = await updateJobOperationOrder(client, updates);
  if (updateSortOrders.some((update) => update.error))
    return json(
      {},
      await flash(
        request,
        error(updateSortOrders, "Failed to update sort order")
      )
    );

  if (jobId) {
    const recalculateDependencies = await recalculateJobOperationDependencies(
      getCarbonServiceRole(),
      {
        jobId: jobId,
        companyId: companyId,
        userId: userId,
      }
    );
    if (recalculateDependencies.error)
      return json(
        {},
        await flash(
          request,
          error(recalculateDependencies, "Failed to recalculate dependencies")
        )
      );
  } else {
    return json(
      {},
      await flash(
        request,
        error(null, "Failed to receive a job id to recalculate dependencies")
      )
    );
  }

  return null;
}
