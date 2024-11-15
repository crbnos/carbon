import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { makeDurations } from "~/utils/durations";
import { path } from "~/utils/path";
import type { OperationWithDetails } from "./operations.service";
import {
  getJobByOperationId,
  getJobFiles,
  getJobMaterialsByOperationId,
  getJobOperationById,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getThumbnailPathByItemId,
} from "./operations.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {});

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const [events, quantities, job, operation] = await Promise.all([
    getProductionEventsForJobOperation(client, {
      operationId,
      userId,
    }),
    getProductionQuantitiesForJobOperation(client, operationId),
    getJobByOperationId(client, operationId),
    getJobOperationById(client, operationId),
  ]);

  if (job.error) {
    throw redirect(
      path.to.operations,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  if (operation.error) {
    throw redirect(
      path.to.operations,
      await flash(request, error(operation.error, "Failed to fetch operation"))
    );
  }

  if (!job.data.itemId) {
    throw redirect(
      path.to.operations,
      await flash(request, error("Item ID is required", "Failed to fetch item"))
    );
  }

  const thumbnailPath = await getThumbnailPathByItemId(client, job.data.itemId);

  return defer({
    events: events.data ?? [],
    quantities: (quantities.data ?? []).reduce(
      (acc, curr) => {
        if (curr.type === "Scrap") {
          acc.scrap += curr.quantity;
        } else if (curr.type === "Production") {
          acc.production += curr.quantity;
        } else if (curr.type === "Rework") {
          acc.rework += curr.quantity;
        }
        return acc;
      },
      { scrap: 0, production: 0, rework: 0 }
    ),
    job: job.data,
    files: getJobFiles(client, companyId, job.data),
    materials: getJobMaterialsByOperationId(client, operation.data?.[0]),
    operation: makeDurations(operation.data?.[0]) as OperationWithDetails,
    thumbnailPath,
  });
}
