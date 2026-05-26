import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { unitOfMeasureValidator } from "~/modules/items";
import {
  getUnitOfMeasure,
  upsertUnitOfMeasure
} from "~/modules/items/items.service.server";
import { UnitOfMeasureForm } from "~/modules/items/ui/UnitOfMeasure";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, uomsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { uomId } = params;
  if (!uomId) throw notFound("uomId not found");

  const unitOfMeasure = await getUnitOfMeasure(uomId);

  return {
    unitOfMeasure: unitOfMeasure?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(unitOfMeasureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw notFound("id not found");

  const updateUnitOfMeasure = await upsertUnitOfMeasure({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateUnitOfMeasure.error) {
    return data(
      {},
      await flash(
        request,
        error(updateUnitOfMeasure.error, "Failed to update unit of measure")
      )
    );
  }

  throw redirect(
    `${path.to.uoms}?${getParams(request)}`,
    await flash(request, success("Updated unit of measure"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(uomsQuery(getCompanyId()).queryKey, null);
  return await serverAction();
}

export default function EditUnitOfMeasuresRoute() {
  const { unitOfMeasure } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: unitOfMeasure?.id ?? undefined,
    name: unitOfMeasure?.name ?? "",
    code: unitOfMeasure?.code ?? "",
    ...getCustomFields(unitOfMeasure?.customFields)
  };

  return (
    <UnitOfMeasureForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
