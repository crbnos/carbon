import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  SupplierStatusForm,
  supplierStatusValidator,
  upsertSupplierStatus,
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

  const validation = await validator(supplierStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertSupplierStatus = await upsertSupplierStatus(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertSupplierStatus.error) {
    return modal
      ? json(insertSupplierStatus)
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
    ? json(insertSupplierStatus, { status: 201 })
    : redirect(
        `${path.to.supplierStatuses}?${getParams(request)}`,
        await flash(request, success("Supplier status created"))
      );
}

export default function NewSupplierStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
  };

  return (
    <SupplierStatusForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
