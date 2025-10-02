import { useLoaderData, useParams } from "@remix-run/react";

import { JobOperation } from "~/components";

import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import {
  getJobByOperationId,
  getJobFiles,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobOperationById,
  getJobOperationProcedure,
  getKanbanByJobId,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getThumbnailPathByItemId,
  getTrackedEntitiesByMakeMethodId,
  getWorkCenter,
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";
import { makeDurations } from "~/utils/durations";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");

  const serviceRole = await getCarbonServiceRole();

  const [events, quantities, job, operation] = await Promise.all([
    getProductionEventsForJobOperation(serviceRole, {
      operationId,
      userId,
    }),
    getProductionQuantitiesForJobOperation(serviceRole, operationId),
    getJobByOperationId(serviceRole, operationId),
    getJobOperationById(serviceRole, operationId),
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

  const [thumbnailPath, trackedEntities, jobMakeMethod, kanban] =
    await Promise.all([
      getThumbnailPathByItemId(serviceRole, operation.data?.[0].itemId),
      getTrackedEntitiesByMakeMethodId(
        serviceRole,
        operation.data?.[0].jobMakeMethodId
      ),
      getJobMakeMethod(serviceRole, operation.data?.[0].jobMakeMethodId),
      getKanbanByJobId(serviceRole, job.data.id),
    ]);

  // If no trackedEntityId is provided in the URL but trackedEntities exist,
  // redirect to the same URL with the last trackedEntityId as a search param
  if (
    !trackedEntityId &&
    trackedEntities.data &&
    trackedEntities.data.length > 0 &&
    // Check if any tracked entity has an attribute for this operation
    !trackedEntities.data.every((entity) => {
      const attributes = entity.attributes as Record<string, unknown>;
      return Object.keys(attributes).some((key) => key.startsWith(`Operation`));
    })
  ) {
    const lastTrackedEntity =
      trackedEntities.data[trackedEntities.data.length - 1];
    const redirectUrl = new URL(request.url);
    redirectUrl.searchParams.set("trackedEntityId", lastTrackedEntity.id);
    throw redirect(redirectUrl.toString());
  }

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
    jobMakeMethod: jobMakeMethod.data,
    kanban: kanban.data,
    files: getJobFiles(
      serviceRole,
      companyId,
      job.data,
      operation.data?.[0].itemId
    ),
    materials: getJobMaterialsByOperationId(serviceRole, {
      operation: operation.data?.[0],
      trackedEntityId: trackedEntityId ?? trackedEntities?.data?.[0]?.id,
      requiresSerialTracking:
        jobMakeMethod.data?.requiresSerialTracking ?? false,
    }),
    trackedEntities: trackedEntities.data ?? [],
    operation: makeDurations(operation.data?.[0]) as OperationWithDetails,
    procedure: getJobOperationProcedure(serviceRole, operation.data?.[0].id),
    workCenter: getWorkCenter(serviceRole, operation.data?.[0].workCenterId),
    thumbnailPath,
  });
}

export default function OperationRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const {
    events,
    files,
    job,
    jobMakeMethod,
    kanban,
    materials,
    operation,
    procedure,
    thumbnailPath,
    trackedEntities,
    workCenter,
  } = useLoaderData<typeof loader>();

  return (
    <JobOperation
      key={`job-operation-${operationId}`}
      events={events}
      files={files}
      kanban={kanban}
      materials={materials}
      method={jobMakeMethod}
      trackedEntities={trackedEntities}
      operation={operation}
      procedure={procedure}
      job={job}
      thumbnailPath={thumbnailPath}
      workCenter={workCenter}
    />
  );
}
