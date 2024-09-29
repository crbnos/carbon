import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { makeDurations } from "~/utils/jobs";
import { path } from "~/utils/path";
import type { OperationWithDetails } from "./jobs.service";
import {
  getJobByOperationId,
  getJobDocuments,
  getJobMaterialsByOperationId,
  getJobOperationById,
  getProductionEventsForJobOperation,
} from "./jobs.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {});

  const { operationId, workCenterId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const [events, job, operation] = await Promise.all([
    getProductionEventsForJobOperation(client, {
      operationId,
      userId,
    }),
    getJobByOperationId(client, operationId),
    getJobOperationById(client, operationId),
  ]);

  if (job.error) {
    throw redirect(
      path.to.workCenter(workCenterId!),
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  if (operation.error) {
    throw redirect(
      path.to.workCenter(workCenterId!),
      await flash(request, error(operation.error, "Failed to fetch operation"))
    );
  }

  return defer({
    events: events.data ?? [],
    job: job.data,
    files: getJobDocuments(client, companyId, job.data),
    materials: getJobMaterialsByOperationId(client, operation.data?.[0]),
    operation: makeDurations(operation.data?.[0]) as OperationWithDetails,
  });
}
