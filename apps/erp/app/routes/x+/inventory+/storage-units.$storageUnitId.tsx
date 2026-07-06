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
import {
  getEffectiveWorkCenterId,
  getStorageUnit,
  StorageUnitForm,
  storageUnitValidator,
  upsertStorageUnit
} from "~/modules/inventory";
import { getWorkCentersList } from "~/modules/resources";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, storageUnitsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { storageUnitId } = params;
  if (!storageUnitId) throw notFound("storageUnitId not found");

  const [storageUnit, effectiveWorkCenter, workCenters] = await Promise.all([
    getStorageUnit(client, storageUnitId),
    getEffectiveWorkCenterId(client, storageUnitId),
    getWorkCentersList(client, companyId)
  ]);

  const ownWorkCenterId = storageUnit?.data?.workCenterId ?? null;
  const effectiveWorkCenterId = effectiveWorkCenter?.data ?? null;
  const isInherited = !ownWorkCenterId && !!effectiveWorkCenterId;

  // Find the name of the inherited work center for display
  let inheritedWorkCenterName: string | null = null;
  if (isInherited && effectiveWorkCenterId) {
    const wc = workCenters?.data?.find((w) => w.id === effectiveWorkCenterId);
    inheritedWorkCenterName = wc?.name ?? null;
  }

  return {
    storageUnit: storageUnit?.data ?? null,
    inheritedWorkCenter: isInherited
      ? {
          workCenterId: effectiveWorkCenterId,
          workCenterName: inheritedWorkCenterName
        }
      : null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(storageUnitValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateStorageUnit = await upsertStorageUnit(client, {
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
  const { storageUnit, inheritedWorkCenter } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: storageUnit?.id ?? undefined,
    name: storageUnit?.name ?? "",
    locationId: storageUnit?.locationId ?? "",
    warehouseId: storageUnit?.warehouseId ?? undefined,
    parentId: storageUnit?.parentId ?? undefined,
    workCenterId: storageUnit?.workCenterId ?? undefined,
    storageTypeIds: storageUnit?.storageTypeIds ?? [],
    ...getCustomFields(storageUnit?.customFields)
  };

  return (
    <>
      <StorageUnitForm
        key={initialValues.id}
        initialValues={initialValues}
        locationId={initialValues.locationId}
        inheritedWorkCenter={inheritedWorkCenter}
        onClose={() => navigate(-1)}
      />
      <Outlet />
    </>
  );
}
