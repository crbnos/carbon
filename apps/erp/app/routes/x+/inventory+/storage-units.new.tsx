import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useNavigate, useSearchParams } from "react-router";
import { useUser } from "~/hooks";
import { StorageUnitForm, storageUnitValidator } from "~/modules/inventory";
import { upsertStorageUnit } from "~/modules/inventory/inventory.service.server";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, storageUnitsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(storageUnitValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const createStorageUnit = await upsertStorageUnit({
    ...rest,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId
  });
  if (createStorageUnit.error) {
    return data(
      {},
      await flash(
        request,
        error(createStorageUnit.error, "Failed to insert storageUnit")
      )
    );
  }

  return modal
    ? data(createStorageUnit, { status: 201 })
    : redirect(
        `${path.to.storageUnits}?${getParams(request)}`,
        await flash(request, success("Storage unit created"))
      );
}

export async function clientAction({
  request,
  serverAction
}: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

  const formData = await request.clone().formData();
  const validation = await validator(storageUnitValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  if (companyId && validation.data.locationId) {
    window.clientCache?.setQueryData(
      storageUnitsQuery(companyId, validation.data.locationId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function NewStorageUnitRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { defaults } = useUser();
  const locationId =
    (searchParams.get("location") || defaults.locationId) ?? "";
  const parentId = searchParams.get("parentId") ?? undefined;

  const initialValues = {
    name: "",
    locationId,
    parentId,
    storageTypeIds: []
  };

  return (
    <StorageUnitForm
      initialValues={initialValues}
      locationId={locationId}
      onClose={() => navigate(-1)}
    />
  );
}
