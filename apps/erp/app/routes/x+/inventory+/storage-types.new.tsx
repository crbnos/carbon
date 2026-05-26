import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { storageTypeValidator } from "~/modules/inventory";
import { upsertStorageType } from "~/modules/inventory/inventory.service.server";
import StorageTypeForm from "~/modules/inventory/ui/StorageTypes/StorageTypeForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "parts" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(storageTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertStorageType = await upsertStorageType({
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertStorageType.error) {
    return data(
      {},
      await flash(
        request,
        error(insertStorageType.error, "Failed to insert storage type")
      )
    );
  }

  return modal
    ? data(insertStorageType, { status: 201 })
    : redirect(
        `${path.to.storageTypes}?${getParams(request)}`,
        await flash(request, success("Storage type created"))
      );
}

export default function NewStorageTypeRoute() {
  const navigate = useNavigate();
  const initialValues = { name: "" };

  return (
    <StorageTypeForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
