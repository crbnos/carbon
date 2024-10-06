import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  ProductionQuantityForm,
  getProductionQuantity,
  productionQuantityValidator,
  updateProductionQuantity,
} from "~/modules/production";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const productionQuantity = await getProductionQuantity(client, id);

  return json({
    productionQuantity: productionQuantity?.data ?? null,
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
  const validation = await validator(productionQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const update = await updateProductionQuantity(client, {
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
  const { productionQuantity } = useLoaderData<typeof loader>();

  const initialValues = {
    id: productionQuantity?.id!,
    type: productionQuantity?.type ?? ("Scrap" as "Scrap"),
    jobOperationId: productionQuantity?.jobOperationId ?? "",
    quantity: productionQuantity?.quantity ?? 0,
    createdBy: productionQuantity?.createdBy ?? "",
  };

  return (
    <ProductionQuantityForm
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
