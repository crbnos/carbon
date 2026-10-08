// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { receiptFixedAssetLineUpdateValidator } from "~/modules/inventory";

type ReceiptFixedAssetLineUpdate =
  Database["public"]["Tables"]["receiptFixedAssetLine"]["Update"];

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const parsed = receiptFixedAssetLineUpdateValidator.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!parsed.success) {
    return data({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { id, ...change } = parsed.data;
  let updateData: ReceiptFixedAssetLineUpdate;
  switch (change.field) {
    case "received":
      updateData = { received: change.value === "true" };
      break;
    case "serialNumber":
      updateData = { serialNumber: change.value || null };
      break;
    case "meter":
      updateData = {
        meter: change.value === "" ? null : Number(change.value)
      };
      break;
    case "notes":
      updateData = { notes: change.value.trim() || null };
      break;
    case "outOfService":
      updateData =
        change.value.trim() === ""
          ? { takeOutOfService: false, outOfServiceReason: null }
          : { takeOutOfService: true, outOfServiceReason: change.value.trim() };
      break;
    case "residualDestination":
      updateData = { residualDestination: change.value || null };
      break;
  }

  const serviceRole = getCarbonServiceRole();

  // A posted (or voided) receipt is a record: its lines, the meter included,
  // no longer change.
  const line = await serviceRole
    .from("receiptFixedAssetLine")
    .select("receipt!receiptFixedAssetLine_receiptId_fkey(status)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (line.error || !line.data?.receipt) {
    return data(
      { error: "The receipt line could not be found" },
      { status: 404 }
    );
  }
  if (line.data.receipt.status !== "Draft") {
    return data(
      { error: "A posted receipt can no longer be changed" },
      { status: 400 }
    );
  }

  const update = await serviceRole
    .from("receiptFixedAssetLine")
    .update({ ...updateData, updatedBy: userId })
    .eq("id", id)
    .eq("companyId", companyId);

  return update;
}
