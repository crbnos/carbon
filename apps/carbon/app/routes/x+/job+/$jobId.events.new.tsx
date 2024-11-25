import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getJobOperations,
  ProductionEventForm,
  productionEventValidator,
  upsertProductionEvent,
} from "~/modules/production";
import { getWorkCentersList } from "~/modules/resources";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "production",
  });

  const { jobId } = params;
  if (!jobId) throw notFound("jobId not found");

  const [jobOperations, workCenters] = await Promise.all([
    getJobOperations(client, jobId),
    getWorkCentersList(client, companyId),
  ]);

  const operationOptions = jobOperations.data?.map((operation) => ({
    label: `${operation.description} - ${
      workCenters.data?.find((center) => center.id === operation.workCenterId)
        ?.name
    }`,
    value: operation.id,
  }));

  return json({ operationOptions });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  const { jobId } = params;
  if (!jobId) {
    throw notFound("jobId not found");
  }

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(productionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insert = await upsertProductionEvent(client, {
    ...data,
    companyId,
    createdBy: userId,
  });
  if (insert.error) {
    return json(
      {},
      await flash(
        request,
        error(insert.error, "Failed to insert production event")
      )
    );
  }

  return modal
    ? json(insert, { status: 201 })
    : redirect(
        `${path.to.jobProductionEvents(jobId)}?${getParams(request)}`,
        await flash(request, success("Production event created"))
      );
}

export default function NewProductionEventRoute() {
  const { operationOptions } = useLoaderData<typeof loader>();
  const initialValues = {
    type: "Labor" as const,
    jobOperationId: "",
    startTime: new Date(new Date().setHours(8, 0, 0, 0)).toISOString(),
    employeeId: "",
    workCenterId: "",
    notes: "",
  };

  return (
    <ProductionEventForm
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
