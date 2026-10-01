// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CertificateOfConformanceData } from "./types";

/** Merge-field variable map for a Certificate of Conformance. */
export function buildCertificateOfConformanceVars(
  data: Pick<
    CertificateOfConformanceData,
    "certificate" | "customer" | "purchaseOrderNumber" | "company"
  >
): Record<string, string> {
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "certificate.number": str(data.certificate?.number),
    "certificate.date": str(data.certificate?.date),
    "certificate.purchaseOrderNumber": str(data.purchaseOrderNumber),
    "certificate.signer": str(data.certificate?.signer?.name),
    "customer.name": str(data.customer?.name),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode),
    "company.taxId": str(data.company?.taxId),
    "company.eori": str(data.company?.eori),
    "company.vatNumber": str(data.company?.vatNumber),
    "company.registrationNumber": str(data.company?.registrationNumber)
  };
}
