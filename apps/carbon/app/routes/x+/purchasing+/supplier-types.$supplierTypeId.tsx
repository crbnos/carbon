import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  SupplierTypeForm,
  getSupplierType,
  supplierTypeValidator,
  upsertSupplierType,
} from "~/modules/purchasing";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee",
  });

  const { supplierTypeId } = params;
  if (!supplierTypeId) throw notFound("supplierTypeId not found");

  const supplierType = await getSupplierType(client, supplierTypeId);

  if (supplierType.error) {
    throw redirect(
      `${path.to.supplierTypes}?${getParams(request)}`,
      await flash(
        request,
        error(supplierType.error, "Failed to get supplier type")
      )
    );
  }
  if (supplierType?.data?.protected) {
    throw redirect(
      path.to.supplierTypes,
      await flash(request, error(null, "Cannot edit a protected supplier type"))
    );
  }

  return json({
    supplierType: supplierType.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const formData = await request.formData();
  const validation = await validator(supplierTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateSupplierType = await upsertSupplierType(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateSupplierType.error) {
    return json(
      {},
      await flash(
        request,
        error(updateSupplierType.error, "Failed to update supplier type")
      )
    );
  }

  throw redirect(
    `${path.to.supplierTypes}?${getParams(request)}`,
    await flash(request, success("Updated supplier type"))
  );
}

export default function EditSupplierTypesRoute() {
  const { supplierType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: supplierType.id ?? undefined,
    name: supplierType.name ?? "",
    ...getCustomFields(supplierType.customFields),
  };

  return (
    <SupplierTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
