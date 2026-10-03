// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Pure field-13 ("Conformity Details") builder for the AS9163 Certificate of
 * Conformance. `getCertificateOfConformanceData` (inventory.service.ts) loads
 * the inputs; this only turns them into the printed lines. No I/O.
 */
import { firstArticleItemRevision } from "@carbon/database/first-article";
import type { CertificationLineageRow } from "../quality/certificationLineage";

/**
 * Field 10: the customer's part revision when the order line maps one, else
 * the item's — where an unset revision ('', '0', null) prints "N/C", exactly
 * as the first article report does.
 */
export function certificateLineRevision(
  customerPartRevision: string | null | undefined,
  itemRevision: string | null | undefined
): string {
  return (
    customerPartRevision || firstArticleItemRevision(itemRevision) || "N/C"
  );
}

export type ConformityDetailsInput = {
  /** Shipped lots/serials; only the ones with an expiration date print. */
  lots: { readableId: string; expirationDate: string | null }[];
  /** Latest approved FAI per shipped item. */
  fairs: { itemReadableId: string; fairId: string }[];
  lineage: CertificationLineageRow[];
  nonconformances: { nonConformanceId: string; disposition: string | null }[];
  statements: { id: string; name: string; content: string }[];
  reasonForUpdate: string | null;
  /** Formats a `YYYY-MM-DD` date for print. */
  formatDate: (date: string) => string;
};

export type ConformityDetails = {
  shelfLife: string[];
  fairs: string[];
  materialCertificates: string[];
  processCertificates: string[];
  concessions: string[];
  nonconformances: string[];
  statements: { name: string; content: string }[];
  reasonForUpdate: string | null;
};

/** The disposition that makes a nonconformance a concession (9163 field 13). */
const CONCESSION_DISPOSITION = "Use As Is";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function certificateLine(row: CertificationLineageRow): string {
  const number = row.certificateNumber ?? "";
  const specification = row.specification ? `, ${row.specification}` : "";
  const supplier = row.supplierName ? ` (${row.supplierName})` : "";
  return `${row.name} — ${number}${specification}${supplier}`;
}

export function buildConformityDetails(
  input: ConformityDetailsInput
): ConformityDetails {
  const shelfLife = unique(
    input.lots.flatMap((lot) =>
      lot.expirationDate
        ? [`${lot.readableId}: expires ${input.formatDate(lot.expirationDate)}`]
        : []
    )
  );

  const fairs = unique(
    input.fairs.map((fair) => `${fair.itemReadableId}: ${fair.fairId}`)
  );

  const certified = input.lineage.filter((row) => !row.missing);
  const materialCertificates = unique(
    certified.filter((row) => row.kind === "Material").map(certificateLine)
  );
  const processCertificates = unique(
    certified.filter((row) => row.kind !== "Material").map(certificateLine)
  );

  const concessions: string[] = [];
  const nonconformances: string[] = [];
  for (const ncr of input.nonconformances) {
    if (ncr.disposition === CONCESSION_DISPOSITION) {
      concessions.push(`${ncr.nonConformanceId}: ${CONCESSION_DISPOSITION}`);
    } else {
      nonconformances.push(
        ncr.disposition
          ? `${ncr.nonConformanceId}: ${ncr.disposition}`
          : ncr.nonConformanceId
      );
    }
  }

  const seenStatements = new Set<string>();
  const statements: { name: string; content: string }[] = [];
  for (const statement of input.statements) {
    if (seenStatements.has(statement.id)) continue;
    seenStatements.add(statement.id);
    statements.push({ name: statement.name, content: statement.content });
  }

  return {
    shelfLife,
    fairs,
    materialCertificates,
    processCertificates,
    concessions: unique(concessions),
    nonconformances: unique(nonconformances),
    statements,
    reasonForUpdate: input.reasonForUpdate?.trim() || null
  };
}

/**
 * The customer ship-to a certificate prints (AS9163 field 6), by the same rule
 * as the sales rules' `resolveSalesOrderShipTo`: a drop shipment goes to the
 * order shipment's location — never the header's, and null rather than a
 * fallback when it is missing, since the header is a different address.
 */
export function salesOrderShipToLocationId(
  order: { customerLocationId: string | null } | null,
  orderShipment: {
    dropShipment: boolean | null;
    customerLocationId: string | null;
  } | null
): string | null {
  if (orderShipment?.dropShipment) {
    return orderShipment.customerLocationId ?? null;
  }
  return order?.customerLocationId ?? null;
}

/**
 * The one sales order whose ship-to an invoice-posted shipment can print. A
 * sales invoice has no ship-to of its own (its `locationId` is our warehouse,
 * `invoiceCustomerLocationId` the bill-to): only order-derived lines that all
 * come from ONE order name a destination. Standalone or mixed-order invoices
 * print no address rather than a wrong one.
 */
export function invoiceShipToSalesOrderId(
  invoiceLineSalesOrderIds: readonly (string | null)[]
): string | null {
  const orderIds = new Set(
    invoiceLineSalesOrderIds.filter((id): id is string => !!id)
  );
  return orderIds.size === 1 ? [...orderIds][0] : null;
}
