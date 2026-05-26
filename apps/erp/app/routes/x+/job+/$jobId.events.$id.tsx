import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { productionEventValidator } from "~/modules/production";
import {
  getJobOperations,
  getProductionEvent,
  upsertProductionEvent
} from "~/modules/production/production.service.server";
import { ProductionEventForm } from "~/modules/production/ui/Jobs";
import { getWorkCentersList } from "~/modules/resources/resources.service.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "production"
  });

  const { id, jobId } = params;
  if (!id) throw notFound("id not found");
  if (!jobId) throw notFound("jobId not found");

  const [jobOperations, workCenters, productionEvent] = await Promise.all([
    getJobOperations(jobId),
    getWorkCentersList(),
    getProductionEvent(id)
  ]);

  const operationOptions = jobOperations.data?.map((operation) => ({
    label: `${operation.description} - ${
      workCenters.data?.find((center) => center.id === operation.workCenterId)
        ?.name
    }`,
    value: operation.id
  }));

  if (productionEvent.error) {
    throw notFound("Failed to fetch production event");
  }

  return { productionEvent: productionEvent.data, operationOptions };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId } = params;
  if (!jobId) throw notFound("jobId or id not found");

  const formData = await request.formData();
  const validation = await validator(productionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const update = await upsertProductionEvent({
    id,
    ...d,
    companyId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update production event")
      )
    );
  }

  if (d.endTime) {
    const serviceRole = await getCarbonServiceRole();
    await serviceRole.functions.invoke("post-production-event", {
      body: {
        productionEventId: id,
        userId,
        companyId
      }
    });
  }

  throw redirect(
    `${path.to.jobProductionEvents(jobId)}?${getParams(request)}`,
    await flash(request, success("Updated production event"))
  );
}

export default function EditProductionEventRoute() {
  const { productionEvent, operationOptions } = useLoaderData<typeof loader>();

  const initialValues = {
    id: productionEvent?.id!,
    type: productionEvent?.type ?? ("Setup" as "Setup"),
    jobOperationId: productionEvent?.jobOperationId ?? "",
    startTime: productionEvent?.startTime ?? "",
    employeeId: productionEvent?.employeeId ?? "",
    workCenterId: productionEvent?.workCenterId ?? "",
    endTime: productionEvent?.endTime ?? "",
    notes: productionEvent?.notes ?? ""
  };

  return (
    <ProductionEventForm
      key={initialValues.id}
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
