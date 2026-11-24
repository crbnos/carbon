// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AddressField, AddressToken } from "../../template";
import type { Company } from "../../types";
import type { PartNumbers } from "../../utils/part-number";

/** A value as a variable prints it: nothing, never "null" or "undefined". */
export const str = (v: unknown): string => (v == null ? "" : String(v));

/** "FOB — Hamburg", or nothing without an incoterm. */
export const incotermText = (
  incoterm: string | null | undefined,
  location: string | null | undefined
) => (incoterm ? `${incoterm}${location ? ` — ${location}` : ""}` : "");

type Text = string | null | undefined;

export function addressVars<P extends string>(
  prefix: P,
  address: {
    name?: Text;
    addressLine1?: Text;
    addressLine2?: Text;
    city?: Text;
    stateProvince?: Text;
    postalCode?: Text;
    country?: Text;
  }
): Record<AddressToken<P>, string> {
  const values: Record<AddressField, string> = {
    name: str(address.name),
    addressLine1: str(address.addressLine1),
    addressLine2: str(address.addressLine2),
    city: str(address.city),
    statePostal: [address.stateProvince, address.postalCode]
      .filter(Boolean)
      .join(" "),
    country: str(address.country)
  };
  return Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      `${prefix}.${field}`,
      value
    ])
  ) as Record<AddressToken<P>, string>;
}

/** A sales line's part numbers, each on its own whatever its display choice. */
export const linePartNumberVars = (parts: PartNumbers) => ({
  "line.itemId": str(parts.ours),
  "line.customerPartId": str(parts.theirs),
  "line.customerPartRevision": str(parts.theirsRevision)
});

/** The variables every document prints of the company. */
export function companyVars(company: Company | null | undefined) {
  return {
    "company.name": str(company?.name),
    "company.city": str(company?.city),
    "company.country": str(company?.countryCode),
    "company.taxId": str(company?.taxId),
    "company.eori": str(company?.eori),
    "company.vatNumber": str(company?.vatNumber),
    "company.registrationNumber": str(company?.registrationNumber)
  };
}
