import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getStorageType,
  storageTypeValidator,
  upsertStorageType
} from "~/modules/inventory";
import StorageTypeForm from "~/modules/inventory/ui/StorageTypes/StorageTypeForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const storageType = await getStorageType(id);

  return {
    storageType: storageType?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(storageTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateStorageType = await upsertStorageType({
    id,
    ...validation.data,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateStorageType.error) {
    return data(
      {},
      await flash(
        request,
        error(updateStorageType.error, "Failed to update storage type")
      )
    );
  }

  throw redirect(
    `${path.to.storageTypes}?${getParams(request)}`,
    await flash(request, success("Updated storage type"))
  );
}

export default function EditStorageTypeRoute() {
  const { storageType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: storageType?.id ?? undefined,
    name: storageType?.name ?? "",
    ...getCustomFields(storageType?.customFields)
  };

  return (
    <StorageTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
