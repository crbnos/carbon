// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { RecordOutlet, useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { storageUnitValidator } from "~/modules/inventory/inventory.models";
import {
  getEffectiveWorkCenterId,
  getStorageUnit
} from "~/modules/inventory/inventory.service";
import { StorageUnitForm } from "~/modules/inventory/ui";
import { getWorkCentersList } from "~/modules/resources/resources.service";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(storageUnitValidator).request(args, {
    params: ["storageUnitId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: _, ...storageUnit } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.updateStorageUnit({
    ...storageUnit,
    id: input.params.storageUnitId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // An error is toasted and the drawer stays open.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    `${path.to.storageUnits}?${getParams(args.request)}`,
    { message: "Updated storage unit" }
  );
}

export default function EditStorageUnitRoute() {
  const { storageUnit, inheritedWorkCenter } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

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
        onClose={() => closeRoute()}
      />
      <RecordOutlet />
    </>
  );
}
