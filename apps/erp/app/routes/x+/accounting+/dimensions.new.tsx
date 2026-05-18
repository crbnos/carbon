import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { dimensionValidator, upsertDimension } from "~/modules/accounting";
import { DimensionForm } from "~/modules/accounting/ui/Dimensions";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyGroupId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(dimensionValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is not used for creation
  const { id, dimensionValues, ...rest } = validation.data;

  const insertDimension = await upsertDimension(
    {
      ...rest,
      companyGroupId,
      createdBy: userId
    },
    dimensionValues
  );

  if (insertDimension.error) {
    return data(
      {},
      await flash(
        request,
        error(insertDimension.error, "Failed to create dimension")
      )
    );
  }

  return redirect(
    `${path.to.dimensions}?${getParams(request)}`,
    await flash(request, success("Dimension created"))
  );
}

export default function NewDimensionRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    entityType: "Custom" as const,
    active: true,
    required: false,
    dimensionValues: [] as string[]
  };

  return (
    <DimensionForm initialValues={initialValues} onClose={() => navigate(-1)} />
  );
}
