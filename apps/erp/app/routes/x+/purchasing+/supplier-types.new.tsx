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
import {
  supplierTypeValidator,
  upsertSupplierType
} from "~/modules/purchasing";
import { SupplierTypeForm } from "~/modules/purchasing/ui/SupplierTypes";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, supplierTypesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "purchasing"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(supplierTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertSupplierType = await upsertSupplierType(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertSupplierType.error) {
    return modal
      ? insertSupplierType
      : redirect(
          `${path.to.supplierTypes}?${getParams(request)}`,
          await flash(
            request,
            error(insertSupplierType.error, "Failed to insert supplier type")
          )
        );
  }

  return modal
    ? data(insertSupplierType, { status: 201 })
    : redirect(
        `${path.to.supplierTypes}?${getParams(request)}`,
        await flash(request, success("Supplier type created"))
      );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    supplierTypesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewSupplierTypesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <SupplierTypeForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
