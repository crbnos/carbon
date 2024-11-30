import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  UnitOfMeasureForm,
  getUnitOfMeasure,
  unitOfMeasureValidator,
  upsertUnitOfMeasure,
} from "~/modules/items";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, queryClient, uomsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { uomId } = params;
  if (!uomId) throw notFound("uomId not found");

  const unitOfMeasure = await getUnitOfMeasure(client, uomId, companyId);

  return json({
    unitOfMeasure: unitOfMeasure?.data ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const formData = await request.formData();
  const validation = await validator(unitOfMeasureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw notFound("id not found");

  const updateUnitOfMeasure = await upsertUnitOfMeasure(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateUnitOfMeasure.error) {
    return json(
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
  const companyId = getCompanyId();
  if (!companyId) {
    return await serverAction();
  }

  queryClient.invalidateQueries({ queryKey: uomsQuery(companyId).queryKey });
  return await serverAction();
}

export default function EditUnitOfMeasuresRoute() {
  const { unitOfMeasure } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: unitOfMeasure?.id ?? undefined,
    name: unitOfMeasure?.name ?? "",
    code: unitOfMeasure?.code ?? "",
    ...getCustomFields(unitOfMeasure?.customFields),
  };

  return (
    <UnitOfMeasureForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
