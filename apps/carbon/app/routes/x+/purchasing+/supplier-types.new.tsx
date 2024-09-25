import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  SupplierTypeForm,
  supplierTypeValidator,
  upsertSupplierType,
} from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "purchasing",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(supplierTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertSupplierType = await upsertSupplierType(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertSupplierType.error) {
    return modal
      ? json(insertSupplierType)
      : redirect(
          `${path.to.supplierTypes}?${getParams(request)}`,
          await flash(
            request,
            error(insertSupplierType.error, "Failed to insert supplier type")
          )
        );
  }

  return modal
    ? json(insertSupplierType, { status: 201 })
    : redirect(
        `${path.to.supplierTypes}?${getParams(request)}`,
        await flash(request, success("Supplier type created"))
      );
}

export default function NewSupplierTypesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
  };

  return (
    <SupplierTypeForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
