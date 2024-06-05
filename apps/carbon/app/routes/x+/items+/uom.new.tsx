import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  UnitOfMeasureForm,
  unitOfMeasureValidator,
  upsertUnitOfMeasure,
} from "~/modules/parts";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(unitOfMeasureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertUnitOfMeasure = await upsertUnitOfMeasure(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertUnitOfMeasure.error) {
    return json(
      {},
      await flash(
        request,
        error(insertUnitOfMeasure.error, "Failed to insert unit of measure")
      )
    );
  }

  return modal
    ? json(insertUnitOfMeasure, { status: 201 })
    : redirect(
        `${path.to.uoms}?${getParams(request)}`,
        await flash(request, success("Unit of measure created"))
      );
}

export default function NewUnitOfMeasuresRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    code: "",
  };

  return (
    <UnitOfMeasureForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
