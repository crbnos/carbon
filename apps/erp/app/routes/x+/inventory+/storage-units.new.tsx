// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useSearchParams } from "react-router";
import { useUser } from "~/hooks";
import { storageUnitValidator } from "~/modules/inventory/inventory.models";
import { StorageUnitForm } from "~/modules/inventory/ui";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(storageUnitValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _, ...storageUnit } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.createStorageUnit({
    ...storageUnit,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // A modal reads the new unit; an error is toasted and the form stays open.
  if (result.error || input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(
    `${path.to.storageUnits}?${getParams(args.request)}`,
    { message: "Storage unit created" }
  );
}

export default function NewStorageUnitRoute() {
  const closeRoute = useCloseRoute();
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
      onClose={() => closeRoute()}
    />
  );
}
