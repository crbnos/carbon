// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { storageTypeValidator } from "~/modules/inventory/inventory.models";
import { getStorageType } from "~/modules/inventory/inventory.service";
import StorageTypeForm from "~/modules/inventory/ui/StorageTypes/StorageTypeForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const storageType = await getStorageType(client, id);

  return {
    storageType: storageType?.data ?? null
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(storageTypeValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.inventory.updateStorageType({
    ...input.data,
    id: input.params.id,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // An error is toasted and the drawer stays open.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    `${path.to.storageTypes}?${getParams(args.request)}`,
    { message: "Updated storage type" }
  );
}

export default function EditStorageTypeRoute() {
  const { storageType } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: storageType?.id ?? undefined,
    name: storageType?.name ?? "",
    ...getCustomFields(storageType?.customFields)
  };

  return (
    <StorageTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
