// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PackingSlipData } from "./types";

/** Merge-field variable map for a Packing Slip. */
export function buildPackingSlipVars(
  data: Pick<
    PackingSlipData,
    "shipment" | "customer" | "shippingAddress" | "company"
  >
): Record<string, string> {
  const s = data.shipment;
  const a = data.shippingAddress;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "shipment.number": str(s?.shipmentId),
    "shipment.trackingNumber": str(s?.trackingNumber),
    "customer.name": str(data.customer?.name),
    "customer.addressLine1": str(a?.addressLine1),
    "customer.city": str(a?.city),
    "customer.country": str(a?.countryCode),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode),
    "company.taxId": str(data.company?.taxId),
    "company.eori": str(data.company?.eori),
    "company.vatNumber": str(data.company?.vatNumber),
    "company.registrationNumber": str(data.company?.registrationNumber)
  };
}
