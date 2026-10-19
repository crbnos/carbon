// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { leaseLineValidator } from "~/modules/purchasing/purchasing.models";
import { saveDraftLeaseLine } from "~/modules/purchasing/purchasing.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "lease-line-update");

/** The asset fields the setup grids edit one cell at a time, as
 *  `leaseLineValidator` names them. */
const LINE_FIELDS = [
  "description",
  "serialNumber",
  "locationId",
  "paymentAmount",
  "fairValue",
  "economicLifeMonths",
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain"
] as const;
type LineField = (typeof LINE_FIELDS)[number];

const isLineField = (field: string): field is LineField =>
  (LINE_FIELDS as readonly string[]).includes(field);

const SWITCHES: LineField[] = [
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionReasonablyCertain"
];

/**
 * One field of a Draft lease's asset, saved from a setup grid cell.
 *
 * The current asset is read, the one field swapped in, and the merged asset
 * runs through the validator the asset form uses. `saveDraftLeaseLine` saves
 * it and, when the payment or the purchase option changed, cuts the asset's
 * payment rows again in the same transaction. Returns `{ error }`: a cell
 * reverts on error, and nothing flashes.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id, lineId } = params;
  if (!id || !lineId) {
    return data({ error: "Asset not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const field = formData.get("field");
  const value = formData.get("value");
  if (
    typeof field !== "string" ||
    !isLineField(field) ||
    (typeof value !== "string" && value !== null)
  ) {
    return data({ error: "Invalid form data" }, { status: 400 });
  }

  // The asset must belong to the URL's lease.
  const current = await client
    .from("leaseLine")
    .select(
      "id, leaseId, description, serialNumber, locationId, paymentAmount, fairValue, economicLifeMonths, ownershipTransfers, specializedAsset, purchaseOptionAmount, purchaseOptionReasonablyCertain"
    )
    .eq("id", lineId)
    .eq("leaseId", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (current.error || !current.data) {
    return data({ error: "Asset not found" }, { status: 404 });
  }
  const line = current.data;

  const merged: Record<string, string | number | boolean | null> = {
    ...line
  };
  merged[field] = SWITCHES.includes(field) ? value === "on" : value || null;
  // A purchase option that is no longer there cannot be reasonably certain.
  if (field === "purchaseOptionAmount" && !value) {
    merged.purchaseOptionReasonablyCertain = false;
  }

  const form = new FormData();
  for (const [key, term] of Object.entries(merged)) {
    if (typeof term === "boolean") {
      if (term) form.append(key, "on");
    } else if (term !== null && term !== "") {
      form.append(key, String(term));
    }
  }

  const validation = await validator(leaseLineValidator).validate(form);
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ??
      "This asset is not valid";
    return data({ error: message }, { status: 400 });
  }

  const { id: _id, leaseId: _leaseId, ...asset } = validation.data;
  try {
    // Refuses a lease that is not a Draft.
    await saveDraftLeaseLine(getDatabaseClient(), {
      leaseId: id,
      leaseLineId: lineId,
      companyId,
      userId,
      line: asset
    });
  } catch (err) {
    logger.error("lease line update failed", {
      companyId,
      leaseLineId: lineId,
      field,
      error: err
    });
    return data(
      { error: getErrorMessage(err, "Failed to update the asset") },
      { status: 400 }
    );
  }

  return data({ error: null });
}
