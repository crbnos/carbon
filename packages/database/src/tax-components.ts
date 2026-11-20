// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure tax-code arithmetic shared by the resolver, posting, the receipt and the
// provider syncers. No DB, no I/O, no clock.
//
// A tax code is made of components (one per authority — "TX State", "City of
// Austin"). Each component has a rate, a recoverable percent (the share of
// PURCHASE tax the company can reclaim) and optional effective dates. The
// resolver writes the code's effective rate to a line's `taxPercent`; posting
// splits the line's tax back into components and, on purchases, into a
// recoverable share (to Tax Paid) and a non-recoverable share (into cost).
// See .ai/specs/2026-10-16-multi-jurisdiction-tax.md.

import {
  applyRate,
  distributeRoundingResidual,
  round,
  SCALE
} from "./precision.ts";

export type TaxComponentInput = {
  id: string;
  name: string;
  taxAuthorityId: string | null;
  /** 0..1 */
  taxPercent: number;
  /** 0..1 — the share of this component's tax a purchase can reclaim */
  recoverablePercent: number;
  sequence: number;
  /** Tax on tax: applies to the base plus every earlier component's tax. */
  isCompound: boolean;
  taxReceivedAccountId: string | null;
  taxPaidAccountId: string | null;
  /** YYYY-MM-DD, inclusive; null = always */
  effectiveDate: string | null;
  /** YYYY-MM-DD, inclusive; null = never */
  expirationDate: string | null;
};

export type TaxCodeInput = {
  id: string;
  calculationType: "Normal" | "Reverse Charge";
  taxesShipping: boolean;
  components: TaxComponentInput[];
};

export type ComponentTax = {
  component: TaxComponentInput;
  taxAmount: number;
  recoverableAmount: number;
  nonRecoverableAmount: number;
};

/**
 * The components in force on `date`, in sequence order. Dates are
 * `YYYY-MM-DD` strings, so lexicographic order is chronological.
 */
export function effectiveComponents(
  code: Pick<TaxCodeInput, "components">,
  date: string
): TaxComponentInput[] {
  return code.components
    .filter(
      (c) =>
        (!c.effectiveDate || c.effectiveDate <= date) &&
        (!c.expirationDate || date <= c.expirationDate)
    )
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}

/**
 * Each component's rate against the line's base, compounding included, in the
 * order given. A compound component taxes the base plus the tax of every
 * component before it.
 */
function componentRates(components: TaxComponentInput[]): number[] {
  let accumulated = 0;
  return components.map((component) => {
    const rate = component.isCompound
      ? component.taxPercent * (1 + accumulated)
      : component.taxPercent;
    accumulated += rate;
    return rate;
  });
}

/** The combined rate of the components, compounding included. */
export function effectiveTaxPercent(components: TaxComponentInput[]): number {
  return componentRates(components).reduce((total, rate) => total + rate, 0);
}

/**
 * The rate a line using `code` is CHARGED on `date`, rounded to internal
 * scale: it is stored as the line's `taxPercent`. 0 for a Reverse Charge
 * code — the seller charges no tax (EU B2B sale, a reverse charge or use tax
 * purchase); only purchase posting self-assesses it, from the components.
 * Every default of a line's `taxPercent` from a code goes through this.
 */
export function chargedTaxPercent(
  code: Pick<TaxCodeInput, "calculationType" | "components">,
  date: string
): number {
  if (code.calculationType === "Reverse Charge") return 0;
  // Summing components leaves float noise (0.15000000000000002).
  return round(effectiveTaxPercent(effectiveComponents(code, date)));
}

/**
 * Split a line's tax across its components, then split each component's part
 * into a recoverable and a non-recoverable share.
 *
 * `lineTax` is authoritative — on a purchase it is the amount the supplier
 * charged, which can differ from base × rate. It is apportioned in proportion
 * to each component's exact tax, and the parts are rounded with
 * `distributeRoundingResidual`, so they always sum to `lineTax` exactly.
 */
export function splitLineTax(args: {
  base: number;
  lineTax: number;
  components: TaxComponentInput[];
  scale: number;
}): ComponentTax[] {
  const { base, lineTax, components, scale } = args;
  if (components.length === 0) return [];

  const exact = componentRates(components).map((rate) => base * rate);
  const exactTotal = exact.reduce((total, value) => total + value, 0);
  const weights =
    exactTotal === 0
      ? components.map(() => 1 / components.length)
      : exact.map((value) => value / exactTotal);
  const parts = distributeRoundingResidual(
    weights.map((weight) => lineTax * weight),
    round(lineTax, scale),
    scale
  );

  return components.map((component, index) => {
    const taxAmount = parts[index]!;
    const recoverableAmount = round(
      taxAmount * component.recoverablePercent,
      scale
    );
    return {
      component,
      taxAmount,
      recoverableAmount,
      nonRecoverableAmount: round(taxAmount - recoverableAmount, scale)
    };
  });
}

/** The recoverable share of a split line's tax. */
export function recoverableTax(parts: ComponentTax[]): number {
  return parts.reduce((total, part) => total + part.recoverableAmount, 0);
}

/**
 * The ids in `taxCodeIds` whose code has no component in force on `date`
 * (or is missing from `codes`). Posting refuses such a line rather than post
 * its tax unsplit, with no authority, or into cost.
 */
export function taxCodesWithoutComponents(
  codes: ReadonlyMap<string, Pick<TaxCodeInput, "components">>,
  taxCodeIds: ReadonlyArray<string | null | undefined>,
  date: string
): string[] {
  return [...new Set(taxCodeIds.filter((id): id is string => !!id))].filter(
    (id) => {
      const code = codes.get(id);
      return !code || effectiveComponents(code, date).length === 0;
    }
  );
}

/**
 * A purchase line's tax split by its code's components (base amounts):
 * `taxParts` splits the supplier's tax on a Normal code, `selfAssessedParts`
 * the tax a Reverse Charge code self-assesses at the code's rate. `code`
 * carries only the components in force on the document's tax point. Shared
 * by the purchase invoice posting and the receipt, so both agree on cost.
 */
export function purchaseLineTaxParts(args: {
  base: number;
  /** The supplier's tax on the line; ignored by a Reverse Charge code. */
  taxAmount: number;
  code: TaxCodeInput;
}): { taxParts?: ComponentTax[]; selfAssessedParts?: ComponentTax[] } {
  const { base, code } = args;
  if (code.components.length === 0) return {};
  if (code.calculationType === "Reverse Charge") {
    return {
      selfAssessedParts: splitLineTax({
        base,
        lineTax: round(base * effectiveTaxPercent(code.components)),
        components: code.components,
        scale: SCALE
      })
    };
  }
  return {
    taxParts: splitLineTax({
      base,
      lineTax: args.taxAmount,
      components: code.components,
      scale: SCALE
    })
  };
}

/**
 * The tax a received line's cost carries (`receiptUnitCost`): the supplier's
 * tax less its recoverable share. A Reverse Charge line ignores any supplier
 * tax amount (the supplier charges none) and carries the non-recoverable
 * share of the self-assessed tax instead.
 */
export function receiptLineTax(args: {
  base: number;
  taxAmount: number;
  code: TaxCodeInput | undefined;
}): { taxAmount: number; recoverableTaxAmount: number } {
  if (!args.code || args.code.components.length === 0) {
    return { taxAmount: args.taxAmount, recoverableTaxAmount: 0 };
  }
  const { taxParts, selfAssessedParts } = purchaseLineTaxParts({
    base: args.base,
    taxAmount: args.taxAmount,
    code: args.code
  });
  if (selfAssessedParts) {
    return {
      taxAmount: 0,
      recoverableTaxAmount: -selfAssessedParts.reduce(
        (total, part) => total + part.nonRecoverableAmount,
        0
      )
    };
  }
  return {
    taxAmount: args.taxAmount,
    recoverableTaxAmount: recoverableTax(taxParts ?? [])
  };
}

/**
 * A sales line's tax base. Header shipping is allocated across lines by
 * weight before this is called; a line's share joins its base only when the
 * line's code taxes shipping.
 */
export function lineTaxBase(args: {
  merchandise: number;
  addOnCost: number;
  shippingCost: number;
  allocatedHeaderShipping: number;
  taxesShipping: boolean;
}): number {
  return (
    args.merchandise +
    args.addOnCost +
    args.shippingCost +
    (args.taxesShipping ? args.allocatedHeaderShipping : 0)
  );
}

/**
 * The cost a received unit carries into inventory and GR/IR: its price plus
 * its share of line shipping and of the tax the company cannot reclaim. With
 * no recoverable tax this is the receipt's historical formula.
 */
export function receiptUnitCost(args: {
  unitPrice: number;
  conversionFactor: number;
  purchaseQuantity: number;
  taxAmount: number;
  recoverableTaxAmount: number;
  shippingCost: number;
}): number {
  const factor = args.conversionFactor || 1;
  const inventoryQuantity = args.purchaseQuantity * factor;
  const extras = args.taxAmount - args.recoverableTaxAmount + args.shippingCost;
  return (
    args.unitPrice / factor +
    (inventoryQuantity === 0 ? 0 : extras / inventoryQuantity)
  );
}

/**
 * A credit made from a source document's lines, grouped into one memo per
 * tax rate (spec "Memo tax", grill 5: a memo has one code and one rate, so
 * two rates means two memos). Rows with the same code group only at the same
 * rate — a code whose rate changed between two rows' dates is two rates — and
 * a row with no code groups with the other no-code rows of the same percent.
 * Groups keep the order of their first row, so the first memo is the first
 * row's.
 */
export function groupByTaxRate<T>(
  rows: readonly T[],
  taxOf: (row: T) => { taxCodeId: string | null; taxPercent: number }
): { taxCodeId: string | null; taxPercent: number; rows: T[] }[] {
  const groups = new Map<
    string,
    { taxCodeId: string | null; taxPercent: number; rows: T[] }
  >();
  for (const row of rows) {
    const tax = taxOf(row);
    const taxPercent = round(tax.taxPercent);
    const key = `${tax.taxCodeId ?? ""}|${taxPercent}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { taxCodeId: tax.taxCodeId, taxPercent, rows: [row] });
  }
  return [...groups.values()];
}

/**
 * A memo's amounts from its net (spec "Memo tax"): the tax is computed
 * forward from the net at the currency's decimals, never backwards from a
 * gross, and `amount` is the gross that hits AR or AP.
 */
export function memoAmounts(
  net: number,
  taxPercent: number,
  decimals: number
): { netAmount: number; taxAmount: number; amount: number } {
  const netAmount = round(net, decimals);
  const taxAmount = applyRate(netAmount, taxPercent, decimals);
  return {
    netAmount,
    taxAmount,
    amount: round(netAmount + taxAmount, decimals)
  };
}
