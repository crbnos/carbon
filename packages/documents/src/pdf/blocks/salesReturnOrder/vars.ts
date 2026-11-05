// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import type { MergeToken } from "../../../template";
import { getCountryName } from "../../../utils/shared";
import { addressVars, str } from "../textVars";
import type { ReturnOrderAddress, SalesReturnOrderData } from "./types";

const countryOf = (address?: ReturnOrderAddress | null) =>
  address ? (address.country ?? getCountryName(address.countryCode)) : "";

/**
 * Merge-field variable map for a Sales Return Order (RMA). Tokens mirror
 * `SALES_RETURN_ORDER_MERGE_FIELDS` in template/mergeFields.ts.
 */
export function buildSalesReturnOrderVars(
  data: Pick<
    SalesReturnOrderData,
    | "salesReturnOrder"
    | "salesReturnOrderLines"
    | "customerAddress"
    | "returnToAddress"
    | "company"
    | "currencyCode"
    | "locale"
    | "numberFormatter"
  >
): Record<MergeToken<"salesReturnOrder">, string> {
  const order = data.salesReturnOrder;
  const customer = data.customerAddress;
  const returnTo = data.returnToAddress;
  const date = (v: string | null | undefined) =>
    formatDate(v, undefined, data.locale);
  const total = data.salesReturnOrderLines.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * (line.unitPrice ?? 0),
    0
  );

  return {
    "order.number": str(order?.salesReturnOrderId),
    "order.date": date(order?.orderDate),
    "order.expirationDate": date(order?.expirationDate),
    "order.customerReference": str(order?.customerReference),
    "order.currency": str(data.currencyCode),
    "order.total": total > 0 ? data.numberFormatter.format(total) : "",
    ...addressVars("customer", {
      name: customer?.name,
      addressLine1: customer?.addressLine1,
      addressLine2: customer?.addressLine2,
      city: customer?.city,
      stateProvince: customer?.stateProvince,
      postalCode: customer?.postalCode,
      country: countryOf(customer)
    }),

    ...addressVars("returnTo", {
      name: returnTo?.name ?? data.company?.name,
      addressLine1: returnTo?.addressLine1,
      addressLine2: returnTo?.addressLine2,
      city: returnTo?.city,
      stateProvince: returnTo?.stateProvince,
      postalCode: returnTo?.postalCode,
      country: countryOf(returnTo)
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
