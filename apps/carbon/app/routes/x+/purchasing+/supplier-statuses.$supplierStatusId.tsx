import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  SupplierStatusForm,
  getSupplierStatus,
  supplierStatusValidator,
  upsertSupplierStatus,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee",
  });

  const { supplierStatusId } = params;
  if (!supplierStatusId) throw notFound("supplierStatusId not found");

  const supplierStatus = await getSupplierStatus(client, supplierStatusId);

  if (supplierStatus.error) {
    throw redirect(
      path.to.supplierStatuses,
      await flash(
        request,
        error(supplierStatus.error, "Failed to get supplier status")
      )
    );
  }

  return json({
    supplierStatus: supplierStatus.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const formData = await request.formData();
  const validation = await validator(supplierStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateSupplierStatus = await upsertSupplierStatus(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateSupplierStatus.error) {
    return json(
      {},
      await flash(
        request,
        error(updateSupplierStatus.error, "Failed to update supplier status")
      )
    );
  }

  throw redirect(
    `${path.to.supplierStatuses}?${getParams(request)}`,
    await flash(request, success("Updated supplier status"))
  );
}

export default function EditSupplierStatusesRoute() {
  const { supplierStatus } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: supplierStatus.id ?? undefined,
    name: supplierStatus.name ?? "",
    ...getCustomFields(supplierStatus.customFields),
  };

  return (
    <SupplierStatusForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
