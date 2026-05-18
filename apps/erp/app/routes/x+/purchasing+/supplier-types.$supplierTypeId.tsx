import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getSupplierType,
  supplierTypeValidator,
  upsertSupplierType
} from "~/modules/purchasing";
import { SupplierTypeForm } from "~/modules/purchasing/ui/SupplierTypes";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, supplierTypesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing",
    role: "employee"
  });

  const { supplierTypeId } = params;
  if (!supplierTypeId) throw notFound("supplierTypeId not found");

  const supplierType = await getSupplierType(supplierTypeId);

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

  return {
    supplierType: supplierType.data
  };
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    supplierTypesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(supplierTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateSupplierType = await upsertSupplierType({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateSupplierType.error) {
    return data(
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
    ...getCustomFields(supplierType.customFields)
  };

  return (
    <SupplierTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
