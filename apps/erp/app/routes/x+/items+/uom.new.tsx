import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { unitOfMeasureValidator, upsertUnitOfMeasure } from "~/modules/items";
import { UnitOfMeasureForm } from "~/modules/items/ui/UnitOfMeasure";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, uomsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(unitOfMeasureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertUnitOfMeasure = await upsertUnitOfMeasure(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertUnitOfMeasure.error) {
    return data(
      {},
      await flash(
        request,
        error(insertUnitOfMeasure.error, "Failed to insert unit of measure")
      )
    );
  }

  return modal
    ? data(insertUnitOfMeasure, { status: 201 })
    : redirect(
        `${path.to.uoms}?${getParams(request)}`,
        await flash(request, success("Unit of measure created"))
      );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(uomsQuery(getCompanyId()).queryKey, null);

  return await serverAction();
}

export default function NewUnitOfMeasuresRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    code: ""
  };

  return (
    <UnitOfMeasureForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
