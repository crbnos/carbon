// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { storageTypeValidator } from "~/modules/inventory/inventory.models";
import StorageTypeForm from "~/modules/inventory/ui/StorageTypes/StorageTypeForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "parts" });
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(storageTypeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _, ...storageType } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.createStorageType({
    ...storageType,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // A modal reads the new type; an error is toasted and the form stays open.
  if (result.error || input.formData?.get("type") === "modal") return result;
  return respond(args.request, result).redirect(
    `${path.to.storageTypes}?${getParams(args.request)}`,
    { message: "Storage type created" }
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
