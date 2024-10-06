import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  ProductionEventForm,
  getProductionEvent,
  productionEventValidator,
  updateProductionEvent,
} from "~/modules/production";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const productionEvent = await getProductionEvent(client, id);

  return json({
    productionEvent: productionEvent?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting",
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

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const update = await updateProductionEvent(client, {
    id,
    ...data,
    companyId,
    updatedBy: userId,
  });

  if (update.error) {
    return json(
      {},
      await flash(
        request,
        error(update.error, "Failed to update production event")
      )
    );
  }

  throw redirect(
    `${path.to.jobProductionEvents(jobId)}?${getParams(request)}`,
    await flash(request, success("Updated production event"))
  );
}

export default function EditProductionEventRoute() {
  const { productionEvent } = useLoaderData<typeof loader>();

  const initialValues = {
    id: productionEvent?.id!,
    type: productionEvent?.type ?? ("Setup" as "Setup"),
    jobOperationId: productionEvent?.jobOperationId ?? "",
    startTime: productionEvent?.startTime ?? "",
    employeeId: productionEvent?.employeeId ?? "",
    workCenterId: productionEvent?.workCenterId ?? "",
    endTime: productionEvent?.endTime ?? "",
  };

  return (
    <ProductionEventForm key={initialValues.id} initialValues={initialValues} />
  );
}
