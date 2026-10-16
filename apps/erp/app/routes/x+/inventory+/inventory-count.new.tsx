// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { inventoryCountValidator } from "~/modules/inventory/inventory.models";
import { InventoryCountForm } from "~/modules/inventory/ui";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "inventory" });
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(inventoryCountValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...count } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.createInventoryCount(count);
  // An error is toasted by the form's fetcher.
  if (!result.data) return result;
  return respond(args.request, result).redirect(
    path.to.inventoryCount(result.data.id),
    { message: "Inventory count created" }
  );
}

export default function NewInventoryCountRoute() {
  const closeRoute = useCloseRoute();

  return (
    <InventoryCountForm
      initialValues={{ locationId: "", isBlind: false }}
      onClose={() => closeRoute()}
    />
  );
}
