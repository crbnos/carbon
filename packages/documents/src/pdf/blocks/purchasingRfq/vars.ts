// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  distinctItemText,
  formatCityStatePostalCode,
  formatDate,
  formatQuantity
} from "@carbon/utils";
import type { LineMergeToken, MergeToken } from "../../../template";
import { getCountryName } from "../../../utils/shared";
import { companyVars, str } from "../textVars";
import type { PurchasingRfqData, PurchasingRfqPdfLine } from "./types";

/**
 * Merge-field variable map for a purchasing RFQ. Tokens mirror
 * `PURCHASING_RFQ_MERGE_FIELDS` in template/mergeFields.ts.
 */
export function buildPurchasingRfqVars(
  data: Pick<
    PurchasingRfqData,
    "purchasingRfq" | "shipToAddress" | "contact" | "company" | "locale"
  >
): Record<MergeToken<"purchasingRfq">, string> {
  const rfq = data.purchasingRfq;
  const shipTo = data.shipToAddress;
  const date = (v: string | null | undefined) =>
    formatDate(v, undefined, data.locale);

  return {
    "rfq.number": str(rfq?.rfqId),
    "rfq.date": date(rfq?.rfqDate),
    "rfq.dueDate": date(rfq?.expirationDate),
    "rfq.location": str(shipTo?.name ?? rfq?.locationName),
    "deliverTo.addressLine1": str(shipTo?.addressLine1),
    "deliverTo.addressLine2": str(shipTo?.addressLine2),
    // One line, as an address is written on a letter: "Detroit, MI 48201".
    "deliverTo.cityStatePostal":
      shipTo?.city || shipTo?.stateProvince || shipTo?.postalCode
        ? formatCityStatePostalCode(
            shipTo.city,
            shipTo.stateProvince,
            shipTo.postalCode
          )
        : "",
    "deliverTo.country": shipTo
      ? str(shipTo.country ?? getCountryName(shipTo.countryCode))
      : "",
    "contact.name": str(data.contact?.name),
    "contact.email": str(data.contact?.email),
    ...companyVars(data.company)
  };
}

/** The quantity breaks a supplier prices, printed; a line with none asks for one. */
export function formatQuantityBreaks(
  line: PurchasingRfqPdfLine,
  locale: string
): string[] {
  const quantities =
    Array.isArray(line.quantity) && line.quantity.length > 0
      ? line.quantity
      : [1];
  return quantities.map((quantity) => formatQuantity(quantity, locale));
}

/**
 * A row prints once per quantity break, and
 * the table passes each break as `line.quantity`; elsewhere in the row
 * `{line.quantity}` lists them all.
 */
export function buildPurchasingRfqLineVars(
  line: PurchasingRfqPdfLine,
  rowNumber: number,
  data: Pick<PurchasingRfqData, "locale">
): Record<LineMergeToken<"purchasingRfq">, string> {
  return {
    "line.number": String(rowNumber),
    "line.item": str(line.itemReadableId),
    "line.description": str(
      distinctItemText(line.itemReadableId, line.description)
    ),
    "line.quantity": formatQuantityBreaks(line, data.locale).join(", "),
    "line.unit": str(
      line.purchaseUnitOfMeasureCode ?? line.inventoryUnitOfMeasureCode
    )
  };
}
