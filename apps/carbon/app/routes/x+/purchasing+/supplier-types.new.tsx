import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  SupplierTypeForm,
  supplierTypeValidator,
  upsertSupplierType,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
