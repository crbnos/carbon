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
import { data } from "react-router";
import { storageTypeValidator, upsertStorageType } from "~/modules/inventory";
import StorageTypeForm from "~/modules/inventory/ui/StorageTypes/StorageTypeForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "parts" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  const insertStorageType = await upsertStorageType(client, {
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
  const closeRoute = useCloseRoute();
  const initialValues = { name: "" };

  return (
    <StorageTypeForm
      onClose={() => closeRoute()}
      initialValues={initialValues}
    />
  );
}
