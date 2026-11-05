// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import type { MergeToken } from "../../../template";
import { getCountryName } from "../../../utils/shared";
import { addressVars, str } from "../textVars";
import type { PurchaseReturnOrderData, ReturnOrderAddress } from "./types";

const countryOf = (address?: ReturnOrderAddress | null) =>
  address ? (address.country ?? getCountryName(address.countryCode)) : "";

/**
 * Merge-field variable map for a Purchase Return Order. Tokens mirror
 * `PURCHASE_RETURN_ORDER_MERGE_FIELDS` in template/mergeFields.ts.
 */
export function buildPurchaseReturnOrderVars(
  data: Pick<
    PurchaseReturnOrderData,
    | "purchaseReturnOrder"
    | "purchaseReturnOrderLines"
    | "supplierAddress"
    | "shipFromAddress"
    | "company"
    | "currencyCode"
    | "locale"
    | "numberFormatter"
  >
): Record<MergeToken<"purchaseReturnOrder">, string> {
  const order = data.purchaseReturnOrder;
  const supplier = data.supplierAddress;
  const shipFrom = data.shipFromAddress;
  const date = (v: string | null | undefined) =>
    formatDate(v, undefined, data.locale);
  const total = data.purchaseReturnOrderLines.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * (line.unitPrice ?? 0),
    0
  );

  return {
    "order.number": str(order?.purchaseReturnOrderId),
    "order.date": date(order?.orderDate),
    "order.expirationDate": date(order?.expirationDate),
    "order.supplierReference": str(order?.supplierReference),
    "order.currency": str(data.currencyCode),
    "order.total": total > 0 ? data.numberFormatter.format(total) : "",
    ...addressVars("supplier", {
      name: supplier?.name,
      addressLine1: supplier?.addressLine1,
      addressLine2: supplier?.addressLine2,
      city: supplier?.city,
      stateProvince: supplier?.stateProvince,
      postalCode: supplier?.postalCode,
      country: countryOf(supplier)
    }),

    ...addressVars("shipFrom", {
      name: shipFrom?.name ?? data.company?.name,
      addressLine1: shipFrom?.addressLine1,
      addressLine2: shipFrom?.addressLine2,
      city: shipFrom?.city,
      stateProvince: shipFrom?.stateProvince,
      postalCode: shipFrom?.postalCode,
      country: countryOf(shipFrom)
    }),

    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode),
    "company.taxId": str(data.company?.taxId),
    "company.eori": str(data.company?.eori),
    "company.vatNumber": str(data.company?.vatNumber),
    "company.registrationNumber": str(data.company?.registrationNumber)
  };
}
