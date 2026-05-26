import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import {
  data,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate
} from "react-router";
import { StorageUnitForm, storageUnitValidator } from "~/modules/inventory";
import {
  getStorageUnit,
  upsertStorageUnit
} from "~/modules/inventory/inventory.service.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, storageUnitsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { storageUnitId } = params;
  if (!storageUnitId) throw notFound("storageUnitId not found");

  const storageUnit = await getStorageUnit(storageUnitId);

  return {
    storageUnit: storageUnit?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(storageUnitValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateStorageUnit = await upsertStorageUnit({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateStorageUnit.error) {
    return data(
      {},
      await flash(
        request,
        error(updateStorageUnit.error, "Failed to update storageUnit")
      )
    );
  }

  throw redirect(
    `${path.to.storageUnits}?${getParams(request)}`,
    await flash(request, success("Updated storageUnit"))
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

export default function EditStorageUnitRoute() {
  const { storageUnit } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: storageUnit?.id ?? undefined,
    name: storageUnit?.name ?? "",
    locationId: storageUnit?.locationId ?? "",
    warehouseId: storageUnit?.warehouseId ?? undefined,
    parentId: storageUnit?.parentId ?? undefined,
    storageTypeIds: storageUnit?.storageTypeIds ?? [],
    ...getCustomFields(storageUnit?.customFields)
  };

  return (
    <>
      <StorageUnitForm
        key={initialValues.id}
        initialValues={initialValues}
        locationId={initialValues.locationId}
        onClose={() => navigate(-1)}
      />
      <Outlet />
    </>
  );
}
