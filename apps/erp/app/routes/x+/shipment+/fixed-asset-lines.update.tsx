// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { shipmentFixedAssetLineUpdateValidator } from "~/modules/inventory";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const parsed = shipmentFixedAssetLineUpdateValidator.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!parsed.success) {
    return data({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { id, ...change } = parsed.data;
  const updateData =
    change.field === "shipped"
      ? { shipped: change.value === "true" }
      : change.field === "serialNumber"
        ? { serialNumber: change.value || null }
        : { meter: change.value === "" ? null : Number(change.value) };

  const serviceRole = getCarbonServiceRole();

  const update = await serviceRole
    .from("shipmentFixedAssetLine")
    .update({ ...updateData, updatedBy: userId })
    .eq("id", id)
    .eq("companyId", companyId);

  return update;
}
