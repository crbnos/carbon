import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { productionQuantityValidator } from "~/modules/production";
import {
  getJobOperations,
  getProductionQuantity,
  upsertProductionQuantity
} from "~/modules/production/production.service.server";
import { ProductionQuantityForm } from "~/modules/production/ui/Jobs";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "production"
  });

  const { id, jobId } = params;
  if (!id) throw notFound("id not found");
  if (!jobId) throw notFound("jobId not found");

  const [productionQuantity, jobOperations] = await Promise.all([
    getProductionQuantity(id),
    getJobOperations(jobId)
  ]);

  const operationOptions =
    jobOperations.data?.map((operation) => ({
      label: operation.description ?? "",
      value: operation.id
    })) ?? [];

  return {
    productionQuantity: productionQuantity?.data ?? null,
    operationOptions
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { jobId } = params;
  if (!jobId) throw notFound("jobId or id not found");

  const formData = await request.formData();
  const validation = await validator(productionQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  // If the type is not Scrap, set the scrapReasonId and notes to null
  if (d.type !== "Scrap") {
    d.scrapReasonId = undefined;
  }

  const update = await upsertProductionQuantity({
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
        error(update.error, "Failed to update production quantity")
      )
    );
  }

  throw redirect(
    `${path.to.jobProductionQuantities(jobId)}?${getParams(request)}`,
    await flash(request, success("Updated production quantity"))
  );
}

export default function EditProductionQuantityRoute() {
  const { productionQuantity, operationOptions } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: productionQuantity?.id!,
    type: productionQuantity?.type ?? ("Scrap" as "Scrap"),
    jobOperationId: productionQuantity?.jobOperationId ?? "",
    quantity: productionQuantity?.quantity ?? 0,
    scrapReasonId: productionQuantity?.scrapReasonId ?? "",
    notes: productionQuantity?.notes ?? "",
    createdBy: productionQuantity?.createdBy ?? ""
  };

  return (
    <ProductionQuantityForm
      key={initialValues.id}
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
