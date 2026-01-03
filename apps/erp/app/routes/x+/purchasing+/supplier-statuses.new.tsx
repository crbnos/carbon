import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import {
  supplierStatusValidator,
  upsertSupplierStatus
} from "~/modules/purchasing";
import { SupplierStatusForm } from "~/modules/purchasing/ui/SupplierStatuses";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

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

  const validation = await validator(supplierStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertSupplierStatus = await upsertSupplierStatus(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertSupplierStatus.error) {
    return modal
      ? insertSupplierStatus
      : redirect(
          `${path.to.supplierStatuses}?${getParams(request)}`,
          await flash(
            request,
            error(
              insertSupplierStatus.error,
              "Failed to insert supplier status"
            )
          )
        );
  }

  return modal
    ? data(insertSupplierStatus, { status: 201 })
    : redirect(
        `${path.to.supplierStatuses}?${getParams(request)}`,
        await flash(request, success("Supplier status created"))
      );
}

export default function NewSupplierStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <SupplierStatusForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
