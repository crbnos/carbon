// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AddressField, AddressToken } from "../../template";

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
