// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure construction of `taxLedger` rows — the tax subledger every posted
// document writes in the same transaction as its journal. No DB, no I/O.
//
// One row per line per tax component; a line with no components (a legacy
// line that only has `taxPercent`, or an exempt one) writes one row. Amounts
// are base currency at internal scale (journal parity) plus the document
// currency at its own decimals (what the document showed). See
// .ai/specs/2026-10-16-multi-jurisdiction-tax.md ("The tax subledger").

import { toDocumentAmount } from "./accounting-currency.ts";
import { round } from "./precision.ts";
import type { ComponentTax } from "./tax-components.ts";
import type { Database } from "./types.ts";

type TaxLedgerInsert = Database["public"]["Tables"]["taxLedger"]["Insert"];

/**
 * Every column set, so a multi-row Kysely insert builds one column list that
 * fits every row (lesson "Kysely builds ONE column list per multi-row insert").
 */
export type TaxLedgerRow = Required<
  Omit<TaxLedgerInsert, "id" | "createdAt" | "updatedBy">
>;

export type TaxLedgerLine = {
  documentLineId: string | null;
  taxCodeId: string | null;
  /** The line's tax base, in base currency. */
  taxableBase: number;
  /** From `splitLineTax`; empty for a legacy or exempt line. */
  components: ComponentTax[];
  /** The line's rate, used when `components` is empty. */
  taxPercent: number;
  /** The line's tax in base currency, used when `components` is empty. */
  taxAmount: number;
  exempt: {
    reason: Database["public"]["Enums"]["taxExemptionReason"] | null;
    certificateNumber: string | null;
  } | null;
};

export type BuildTaxLedgerRowsInput = {
  companyId: string;
  createdBy: string;
  source: Database["public"]["Enums"]["taxLedgerSource"];
  documentType: "Sales Invoice" | "Purchase Invoice" | "Memo";
  documentId: string;
  journalId: string;
  postingDate: string;
  customerId?: string | null;
  supplierId?: string | null;
  currencyCode: string;
  /** Foreign units per one base unit; 1 for a base-currency document. */
  exchangeRate: number;
  currencyDecimals: number;
  /** -1 negates every amount: a void, or a credit memo against sales. */
  sign: 1 | -1;
  lines: TaxLedgerLine[];
};

export function buildTaxLedgerRows(
  input: BuildTaxLedgerRowsInput
): TaxLedgerRow[] {
  const signed = (value: number) => (input.sign === -1 ? -value : value);
  const toDocument = (base: number) =>
    toDocumentAmount(base, input.exchangeRate, input.currencyDecimals);

  const row = (
    line: TaxLedgerLine,
    values: {
      component: ComponentTax["component"] | null;
      taxPercent: number;
      recoverablePercent: number;
      taxAmount: number;
      recoverableAmount: number;
      exemptAmount: number;
    }
  ): TaxLedgerRow => {
    const taxableAmount = values.exemptAmount === 0 ? line.taxableBase : 0;
    return {
      companyId: input.companyId,
      createdBy: input.createdBy,
      source: input.source,
      documentType: input.documentType,
      documentId: input.documentId,
      documentLineId: line.documentLineId,
      journalId: input.journalId,
      postingDate: input.postingDate,
      taxCodeId: line.taxCodeId,
      taxCodeComponentId: values.component?.id ?? null,
      componentName: values.component?.name ?? null,
      taxAuthorityId: values.component?.taxAuthorityId ?? null,
      taxPercent: values.taxPercent,
      recoverablePercent: values.recoverablePercent,
      customerId: input.customerId ?? null,
      supplierId: input.supplierId ?? null,
      taxableAmount: signed(round(taxableAmount)),
      taxAmount: signed(round(values.taxAmount)),
      recoverableAmount: signed(round(values.recoverableAmount)),
      exemptAmount: signed(round(values.exemptAmount)),
      documentTaxableAmount: signed(toDocument(taxableAmount)),
      documentTaxAmount: signed(toDocument(values.taxAmount)),
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      taxExemptionReason: line.exempt?.reason ?? null,
      exemptionCertificateNumber: line.exempt?.certificateNumber ?? null
    };
  };

  return input.lines.flatMap((line) => {
    if (line.exempt) {
      return [
        row(line, {
          component: null,
          taxPercent: 0,
          recoverablePercent: 0,
          taxAmount: 0,
          recoverableAmount: 0,
          exemptAmount: line.taxableBase
        })
      ];
    }
    if (line.components.length === 0) {
      return [
        row(line, {
          component: null,
          taxPercent: line.taxPercent,
          recoverablePercent: 0,
          taxAmount: line.taxAmount,
          recoverableAmount: 0,
          exemptAmount: 0
        })
      ];
    }
    return line.components.map((part) =>
      row(line, {
        component: part.component,
        taxPercent: part.component.taxPercent,
        recoverablePercent: part.component.recoverablePercent,
        taxAmount: part.taxAmount,
        recoverableAmount: part.recoverableAmount,
        exemptAmount: 0
      })
    );
  });
}

/**
 * Copies of posted rows with every amount negated, for a void. The void's
 * own journal and date replace the original's.
 */
export function negateTaxLedgerRows(
  rows: TaxLedgerRow[],
  overrides: { journalId: string; postingDate: string; createdBy: string }
): TaxLedgerRow[] {
  return rows.map((r) => ({
    ...r,
    ...overrides,
    taxableAmount: -r.taxableAmount,
    taxAmount: -r.taxAmount,
    recoverableAmount: -r.recoverableAmount,
    exemptAmount: -r.exemptAmount,
    documentTaxableAmount: -r.documentTaxableAmount,
    documentTaxAmount: -r.documentTaxAmount
  }));
}
