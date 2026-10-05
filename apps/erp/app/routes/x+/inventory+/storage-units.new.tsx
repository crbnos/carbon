// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useSearchParams } from "react-router";
import { useUser } from "~/hooks";
import {
  StorageUnitForm,
  storageUnitValidator,
  upsertStorageUnit
} from "~/modules/inventory";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  const createStorageUnit = await upsertStorageUnit(client, {
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
