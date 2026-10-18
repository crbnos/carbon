// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The tax summary a sales document prints under its totals: one row per tax
// component and rate, with the base it was charged on. A posted invoice reads
// its `taxLedger` rows (what the journal posted); a draft invoice, an order or
// a quote splits each line's tax across its code's components. Pure — the
// callers load the rows. See .ai/specs/2026-10-16-multi-jurisdiction-tax.md
// ("Registrations and documents").

import type { Database } from "@carbon/database";
import {
  allocateSalesHeaderShipping,
  distributeRoundingResidual,
  effectiveComponents,
  round,
  SCALE,
  salesTaxableBase,
  splitLineTax,
  type TaxCodeInput
} from "@carbon/utils";

export type TaxSummaryEntry = {
  /** The component's name; null for a line with a bare percent and no code. */
  name: string | null;
  /** 0..1 */
  rate: number;
  /** The amount taxed, in document currency. */
  base: number;
  /** In document currency. */
  tax: number;
};

/** The `taxCode` columns the summary reads, with every component embedded. */
export const TAX_CODE_SUMMARY_SELECT =
  "id, calculationType, taxesShipping, invoiceMessage, taxCodeComponent(id, name, taxAuthorityId, taxPercent, recoverablePercent, sequence, isCompound, taxReceivedAccountId, taxPaidAccountId, effectiveDate, expirationDate)";

export type TaxCodeSummaryRow = {
  id: string;
  calculationType: Database["public"]["Enums"]["taxCalculationType"];
  taxesShipping: boolean;
  invoiceMessage: string | null;
  taxCodeComponent: TaxCodeInput["components"];
};

export type TaxSummaryCode = TaxCodeInput & { invoiceMessage: string | null };

export function toTaxSummaryCodes(
  rows: ReadonlyArray<TaxCodeSummaryRow> | null | undefined
): Map<string, TaxSummaryCode> {
  return new Map(
    (rows ?? []).map((row) => [
      row.id,
      {
        id: row.id,
        calculationType: row.calculationType,
        taxesShipping: row.taxesShipping,
        invoiceMessage: row.invoiceMessage,
        components: (row.taxCodeComponent ?? []).map((component) => ({
          ...component,
          taxPercent: Number(component.taxPercent),
          recoverablePercent: Number(component.recoverablePercent)
        }))
      }
    ])
  );
}

export type TaxSummaryLine = {
  taxCodeId: string | null;
  /** 0..1 — the line's resolved rate. */
  taxPercent: number;
  /** The line's tax base, in document currency. */
  base: number;
};

/**
 * One entry per component of each line's code in force on `date`
 * (YYYY-MM-DD), the line's tax split by `splitLineTax`. A line with no code,
 * or a code with no component in force, is one entry at its own rate.
 */
export function lineTaxSummaryEntries(
  lines: ReadonlyArray<TaxSummaryLine>,
  codes: ReadonlyMap<string, TaxSummaryCode>,
  date: string
): TaxSummaryEntry[] {
  return lines.flatMap((line): TaxSummaryEntry[] => {
    const tax = line.base * line.taxPercent;
    const code = line.taxCodeId ? codes.get(line.taxCodeId) : undefined;
    const components = code ? effectiveComponents(code, date) : [];
    if (components.length === 0) {
      return [{ name: null, rate: line.taxPercent, base: line.base, tax }];
    }
    return splitLineTax({
      base: line.base,
      lineTax: tax,
      components,
      scale: SCALE
    }).map((part) => ({
      name: part.component.name,
      rate: part.component.taxPercent,
      base: line.base,
      tax: part.taxAmount
    }));
  });
}

export type TaxLedgerSummaryRow = {
  journalId: string;
  createdAt: string;
  componentName: string | null;
  taxPercent: number;
  documentTaxableAmount: number;
  documentTaxAmount: number;
};

/**
 * The entries of a posted invoice: the rows of its posting journal. A void
 * writes negated copies on a later journal, so the posting is the journal of
 * the earliest row. Null when there are no rows, or when that journal is not
 * Posted (a Provisional posting, or one the reader cannot see) — the caller
 * then falls back to the lines.
 */
export function postedTaxSummaryEntries(
  rows: ReadonlyArray<TaxLedgerSummaryRow>,
  postedJournalIds: ReadonlySet<string>
): TaxSummaryEntry[] | null {
  if (rows.length === 0) return null;
  const posting = [...rows].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  )[0]!.journalId;
  if (!postedJournalIds.has(posting)) return null;
  return rows
    .filter((row) => row.journalId === posting)
    .map((row) => ({
      name: row.componentName,
      rate: Number(row.taxPercent),
      base: Number(row.documentTaxableAmount),
      tax: Number(row.documentTaxAmount)
    }));
}

/**
 * Group the entries by component name and rate, and apportion `total` — the
 * tax the document's totals print — across the groups with
 * `distributeRoundingResidual`, so the printed rows add up to the printed
 * tax. A group with no rate and no tax (an exempt line) is left out. A
 * document none of whose tax came from a code (every entry unnamed) has no
 * summary: it prints its single tax row, as before tax codes.
 */
export function buildTaxSummary(
  entries: ReadonlyArray<TaxSummaryEntry>,
  total: number,
  decimals: number
): TaxSummaryEntry[] {
  const groups = new Map<string, TaxSummaryEntry>();
  for (const entry of entries) {
    const key = `${entry.name ?? ""}\u0000${entry.rate}`;
    const group = groups.get(key);
    if (group) {
      group.base += entry.base;
      group.tax += entry.tax;
    } else {
      groups.set(key, { ...entry });
    }
  }

  const summary = [...groups.values()]
    .filter((group) => group.rate !== 0 || group.tax !== 0)
    .sort(
      (a, b) =>
        (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
        (a.name ?? "").localeCompare(b.name ?? "") ||
        b.rate - a.rate
    );
  if (summary.every((group) => group.name === null)) return [];

  const sum = summary.reduce((acc, group) => acc + group.tax, 0);
  const exact =
    sum === 0
      ? summary.map((group) => group.tax)
      : summary.map((group) => (total * group.tax) / sum);
  let taxes: number[];
  try {
    taxes = distributeRoundingResidual(exact, round(total, decimals), decimals);
  } catch {
    // The groups disagree with the total by more than rounding; print each
    // group as it is rather than fail the document.
    taxes = summary.map((group) => round(group.tax, decimals));
  }

  return summary.map((group, index) => ({
    name: group.name,
    rate: group.rate,
    base: round(group.base, decimals),
    tax: taxes[index]!
  }));
}

type SalesInvoiceLine = Database["public"]["Views"]["salesInvoiceLines"]["Row"];

/**
 * A draft sales invoice's lines as summary inputs, in document currency. Header
 * shipping is allocated across the lines as the posting allocates it
 * (`allocateSalesHeaderShipping`); a line's share joins its base when its code
 * taxes shipping.
 */
export function salesInvoiceTaxSummaryLines(
  lines: ReadonlyArray<SalesInvoiceLine>,
  headerShipping: number,
  codes: ReadonlyMap<string, TaxSummaryCode>
): TaxSummaryLine[] {
  const postable = lines
    .filter((line) => line.id && line.invoiceLineType !== "Comment")
    .map((line) => ({
      id: line.id!,
      invoiceLineType: line.invoiceLineType ?? "",
      taxCodeId: line.taxCodeId,
      taxPercent: line.taxPercent ?? 0,
      quantity: line.quantity ?? 0,
      unitPrice: line.convertedUnitPrice ?? 0,
      discountPercent: line.discountPercent ?? 0,
      shippingCost: line.convertedShippingCost ?? 0,
      addOnCost: line.convertedAddOnCost ?? 0
    }));

  let allocated = new Map<string, number>();
  try {
    allocated = allocateSalesHeaderShipping(postable, headerShipping);
  } catch {
    // Header shipping with no postable line: nothing to allocate it to.
  }

  return postable.map((line) => {
    const code = line.taxCodeId ? codes.get(line.taxCodeId) : undefined;
    return {
      taxCodeId: line.taxCodeId,
      taxPercent: line.taxPercent,
      base: salesTaxableBase({
        ...line,
        allocatedHeaderShipping: allocated.get(line.id) ?? 0,
        taxesShipping: code?.taxesShipping ?? false
      })
    };
  });
}

/** The distinct VAT clauses of the codes `taxCodeIds` name, in that order. */
export function getInvoiceMessages(
  taxCodeIds: ReadonlyArray<string | null | undefined>,
  codes: ReadonlyMap<string, TaxSummaryCode>
): string[] {
  const messages: string[] = [];
  for (const id of taxCodeIds) {
    const message = id ? codes.get(id)?.invoiceMessage?.trim() : undefined;
    if (message && !messages.includes(message)) messages.push(message);
  }
  return messages;
}

export type TaxRegistrationRow = {
  countryCode: string;
  state: string | null;
  registrationNumber: string;
  effectiveDate: string | null;
  endDate: string | null;
};

/**
 * The seller's tax number to print: its registration for the company's own
 * country in force on `date` (a national one first, then one for the
 * company's state), else `company.taxId` — but only for a company that has
 * adopted tax codes (`hasActiveTaxCodes`). A company with neither a
 * registration in force nor an active code prints no seller number, as
 * before tax codes.
 */
export function resolveSellerRegistration(
  registrations: ReadonlyArray<TaxRegistrationRow> | null | undefined,
  company: {
    countryCode?: string | null;
    stateProvince?: string | null;
    taxId?: string | null;
  },
  date: string,
  hasActiveTaxCodes: boolean
): string | null {
  const inForce = (registrations ?? []).filter(
    (registration) =>
      registration.countryCode === company.countryCode &&
      (!registration.effectiveDate || registration.effectiveDate <= date) &&
      (!registration.endDate || date <= registration.endDate)
  );
  const registration =
    inForce.find((r) => !r.state) ??
    inForce.find((r) => r.state && r.state === company.stateProvince) ??
    inForce[0];
  if (registration?.registrationNumber) return registration.registrationNumber;
  return hasActiveTaxCodes ? company.taxId || null : null;
}
