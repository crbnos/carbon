// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { deleteShipmentLine } from "~/modules/inventory";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const lineDelete = await deleteShipmentLine(client, id);

  if (lineDelete.error) {
    return {
      success: false,
      message: lineDelete.error.message
    };
  }

  return {
    success: true,
    message: "Shipment line deleted successfully"
  };
}
