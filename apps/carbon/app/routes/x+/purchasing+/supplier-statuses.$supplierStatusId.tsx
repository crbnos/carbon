import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  SupplierStatusForm,
  getSupplierStatus,
  supplierStatusValidator,
  upsertSupplierStatus,
} from "~/modules/purchasing";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

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
