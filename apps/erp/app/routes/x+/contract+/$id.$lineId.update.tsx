// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { round } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  customerContractLineValidator,
  getContract,
  getContractLine,
  upsertContractLine
} from "~/modules/sales";

const logger = getLogger("erp", "contract-line-update");

/** The line fields a setup grid edits one cell at a time, as
 *  `customerContractLineValidator` names them. */
const LINE_FIELDS = [
  "revenueType",
  "quantity",
  "rate",
  "rateUnit",
  "discountPercent",
  "startDate",
  "endDate",
  "goLiveDate",
  "revenueMethod",
  "revenueStartDate",
  "revenueEndDate"
] as const;
type LineField = (typeof LINE_FIELDS)[number];

const isLineField = (field: string): field is LineField =>
  (LINE_FIELDS as readonly string[]).includes(field);

/**
 * One field of a Draft contract's line, saved from a setup grid cell.
 *
 * A line validates as a whole (a recurring line needs a rate unit, an end
 * after the start), so the current line is read, the one field swapped in,
 * and the merged line runs through the validator and service the line form
 * uses. Returns `{ error }` — a cell reverts on error, and nothing flashes.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id || !lineId) {
    return data({ error: "Line not found" }, { status: 404 });
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

  const current = await getContractLine(client, lineId);
  if (
    current.error ||
    current.data.companyId !== companyId ||
    current.data.customerContractId !== id
  ) {
    return data({ error: "Line not found" }, { status: 404 });
  }
  const line = current.data;

  const merged: Record<string, string | number | null | undefined> = {
    id: line.id,
    customerContractId: line.customerContractId,
    revenueType: line.revenueType,
    itemId: line.itemId,
    description: line.description,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    rateUnit: line.rateUnit,
    // Stored as a 0–1 fraction; the validator speaks percent points.
    discountPercent: round(Number(line.discountPercent) * 100),
    discountEndsOn: line.discountEndsOn,
    taxPercent: round(Number(line.taxPercent) * 100),
    startDate: line.startDate,
    endDate: line.endDate,
    goLiveDate: line.goLiveDate,
    revenueMethod: line.revenueMethod,
    revenueStartDate: line.revenueStartDate,
    revenueEndDate: line.revenueEndDate,
    projectId: line.projectId
  };
  merged[field] = value || null;

  // A recurring line bills per a unit; a one-time line has none. Switching
  // to Recurring picks the contract's billing frequency, as a new line does.
  if (field === "revenueType") {
    if (value === "One-time") {
      merged.rateUnit = null;
    } else if (!merged.rateUnit) {
      const contract = await getContract(client, id);
      if (contract.error || contract.data?.companyId !== companyId) {
        return data({ error: "Contract not found" }, { status: 404 });
      }
      merged.rateUnit = contract.data.billingFrequency ?? "Month";
    }
  }

  const form = new FormData();
  for (const [key, term] of Object.entries(merged)) {
    if (term !== null && term !== undefined && term !== "") {
      form.append(key, String(term));
    }
  }

  const validation = await validator(customerContractLineValidator).validate(
    form
  );
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ??
      "This line is not valid";
    return data({ error: message }, { status: 400 });
  }

  const { id: _id, ...values } = validation.data;
  // Refuses a contract that is not a Draft and an item that is not a Service.
  const update = await upsertContractLine(client, {
    ...values,
    customerContractId: id,
    id: lineId,
    updatedBy: userId
  });
  if (update.error) {
    logger.error("contract line update failed", {
      companyId,
      lineId,
      field,
      error: update.error
    });
    return data(
      { error: update.error.message || "Failed to update line" },
      { status: 400 }
    );
  }

  return data({ error: null });
}
