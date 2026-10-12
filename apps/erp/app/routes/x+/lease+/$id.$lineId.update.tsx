// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { leaseLineValidator, upsertLeaseLine } from "~/modules/purchasing";
import { regenerateLeasePayments } from "~/modules/purchasing/purchasing.server";
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

/** The fields the asset's payment rows are cut from. */
const PAYMENT_FIELDS: LineField[] = [
  "paymentAmount",
  "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain"
];

const SWITCHES: LineField[] = [
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionReasonablyCertain"
];

/**
 * One field of a Draft lease's asset, saved from a setup grid cell.
 *
 * The current asset is read, the one field swapped in, and the merged asset
 * runs through the validator and service the asset form uses. A change to
 * the payment or the purchase option cuts the asset's payment rows again.
 * Returns `{ error }`: a cell reverts on error, and nothing flashes.
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

  // Refuses a lease that is not a Draft.
  const update = await upsertLeaseLine(client, {
    ...validation.data,
    id: lineId,
    leaseId: id,
    companyId,
    userId
  });
  if (update.error) {
    logger.error("lease line update failed", {
      companyId,
      leaseLineId: lineId,
      field,
      error: update.error
    });
    return data(
      { error: update.error.message || "Failed to update the asset" },
      { status: 400 }
    );
  }

  if (PAYMENT_FIELDS.includes(field)) {
    try {
      await regenerateLeasePayments(getDatabaseClient(), {
        leaseId: id,
        leaseLineId: lineId,
        companyId,
        userId
      });
    } catch (err) {
      logger.error("lease payment rows for an asset failed", {
        companyId,
        leaseLineId: lineId,
        error: err
      });
      return data(
        { error: "Saved the asset, but its payment rows were not cut" },
        { status: 500 }
      );
    }
  }

  return data({ error: null });
}
