// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { distinctItemText, formatDate } from "@carbon/utils";
import type { RowVars } from "../../../template";
import type { Company } from "../../../types";
import { getCountryName } from "../../../utils/shared";
import { addressVars, companyVars, str } from "../textVars";

/**
 * A party/address for the parties block. Pass a resolved display `country`
 * ("United States") when known; renderers fall back to mapping `countryCode`.
 */
export interface ReturnOrderAddress {
  name?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

/** What both sides of a return print the same way, from their own fields. */
export function returnOrderVars<P extends string, Q extends string>(data: {
  number: string | null | undefined;
  orderDate: string | null | undefined;
  expirationDate: string | null | undefined;
  lines: { quantity?: number | null; unitPrice?: number | null }[];
  party: { prefix: P; address?: ReturnOrderAddress | null };
  /** Our own address on the return. Without a name it is the company's. */
  other: { prefix: Q; address?: ReturnOrderAddress | null };
  company: Company;
  currencyCode: string | null;
  locale: string;
  numberFormatter: Intl.NumberFormat;
}) {
  const date = (value: string | null | undefined) =>
    formatDate(value, undefined, data.locale);
  const total = data.lines.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * (line.unitPrice ?? 0),
    0
  );
  const address = (
    from: ReturnOrderAddress | null | undefined,
    name: string | null | undefined
  ) => ({
    name,
    addressLine1: from?.addressLine1,
    addressLine2: from?.addressLine2,
    city: from?.city,
    stateProvince: from?.stateProvince,
    postalCode: from?.postalCode,
    country: from ? (from.country ?? getCountryName(from.countryCode)) : ""
  });
  return {
    "order.number": str(data.number),
    "order.date": date(data.orderDate),
    "order.expirationDate": date(data.expirationDate),
    "order.currency": str(data.currencyCode),
    "order.total": total > 0 ? data.numberFormatter.format(total) : "",
    ...addressVars(
      data.party.prefix,
      address(data.party.address, data.party.address?.name)
    ),
    ...addressVars(
      data.other.prefix,
      address(
        data.other.address,
        data.other.address?.name ?? data.company?.name
      )
    ),
    ...companyVars(data.company)
  };
}

/** A return order's line, as both sides of a return read it. */
export interface ReturnOrderLine {
  id?: string | null;
  lineNumber?: number | null;
  quantity?: number | null;
  unitOfMeasureCode?: string | null;
  unitPrice?: number | null;
  item?: {
    name: string | null;
    readableIdWithRevision: string | null;
  } | null;
  returnReason?: { name: string | null } | null;
}

export function buildReturnOrderLineVars(
  line: ReturnOrderLine,
  rateFormatter: Intl.NumberFormat
): RowVars<"salesReturnOrder", "line"> {
  const itemId = line.item?.readableIdWithRevision;
  return {
    "line.number": str(line.lineNumber),
    "line.itemId": str(itemId),
    "line.itemName": str(distinctItemText(itemId, line.item?.name)),
    "line.quantity": str(line.quantity ?? 0),
    "line.unit": line.unitOfMeasureCode ?? "EA",
    "line.unitPrice": rateFormatter.format(line.unitPrice ?? 0),
    "line.reason": str(line.returnReason?.name)
  };
}
