// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getDefaultRentalRates,
  getRentalAgreement,
  getRentalAgreementLine,
  rentalAgreementLineValidator,
  rentalRateUnits,
  upsertRentalAgreementLine
} from "~/modules/sales";

const logger = getLogger("erp", "rental-agreement-line-update");

/** The line fields a setup grid edits one cell at a time, as
 *  `rentalAgreementLineValidator` names them. */
const LINE_FIELDS = [
  "rateUnit",
  "rate",
  "fairValue",
  "economicLifeMonths",
  "guaranteedResidualValue",
  "unguaranteedResidualValue"
] as const;
type LineField = (typeof LINE_FIELDS)[number];

const isLineField = (field: string): field is LineField =>
  (LINE_FIELDS as readonly string[]).includes(field);

/**
 * One field of a Draft agreement's unit, saved from a setup grid cell.
 *
 * The current line is read, the one field swapped in, and the merged line
 * runs through the validator and service the unit form uses. A new rate
 * frequency starts from its own rate on file, as it does on the form — a
 * rate belongs to its frequency — or 0 when there is none. Returns
 * `{ error }`: a cell reverts on error, and nothing flashes.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id || !lineId) {
    return data({ error: "Unit not found" }, { status: 404 });
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

  const current = await getRentalAgreementLine(client, lineId, companyId);
  if (current.error || current.data.rentalAgreementId !== id) {
    return data({ error: "Unit not found" }, { status: 404 });
  }
  const line = current.data;

  const merged: Record<string, string | number | null | undefined> = {
    id: line.id,
    rentalAgreementId: line.rentalAgreementId,
    fixedAssetId: line.fixedAssetId,
    rateUnit: line.rateUnit,
    rate: line.rate,
    fairValue: line.fairValue,
    economicLifeMonths: line.economicLifeMonths,
    guaranteedResidualValue: line.guaranteedResidualValue,
    unguaranteedResidualValue: line.unguaranteedResidualValue
  };
  merged[field] = value || null;

  if (field === "rateUnit" && value && value !== line.rateUnit) {
    const agreement = await getRentalAgreement(client, id, companyId);
    if (agreement.error || agreement.data?.companyId !== companyId) {
      return data({ error: "Rental agreement not found" }, { status: 404 });
    }
    const { customerId, currencyCode, startDate } = agreement.data;
    if (customerId && currencyCode && startDate) {
      const defaults = await getDefaultRentalRates(client, {
        companyId,
        customerId,
        currencyCode,
        asOf: startDate,
        itemIds: [line.itemId]
      });
      if (defaults.error) {
        logger.error("rental rates read failed", {
          companyId,
          lineId,
          error: defaults.error
        });
        return data(
          { error: "Failed to load the rental rates" },
          { status: 500 }
        );
      }
      const unit = rentalRateUnits.find((option) => option === value);
      merged.rate = (unit && defaults.data[line.itemId]?.[unit]?.rate) ?? 0;
    } else {
      merged.rate = 0;
    }
  }

  const form = new FormData();
  for (const [key, term] of Object.entries(merged)) {
    if (term !== null && term !== undefined && term !== "") {
      form.append(key, String(term));
    }
  }

  const validation = await validator(rentalAgreementLineValidator).validate(
    form
  );
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ??
      "This unit is not valid";
    return data({ error: message }, { status: 400 });
  }

  const { id: _id, itemId: _itemId, ...values } = validation.data;
  // Refuses an agreement that is not a Draft.
  const update = await upsertRentalAgreementLine(client, {
    ...values,
    rentalAgreementId: id,
    id: lineId,
    companyId,
    updatedBy: userId
  });
  if (update.error) {
    logger.error("rental agreement line update failed", {
      companyId,
      lineId,
      field,
      error: update.error
    });
    return data(
      { error: update.error.message || "Failed to update unit" },
      { status: 400 }
    );
  }

  return data({ error: null });
}
