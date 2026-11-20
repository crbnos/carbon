// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { EPSILON, round } from "@carbon/utils";
import { JournalEntrySyncError } from "./posting";
import {
  buildTaxCodeMappingEntityId,
  NO_TAX_CODE_MAPPING_ID,
  type ProviderAccountClass,
  pickRateByPercent,
  type TaxCodeMapping,
  type TaxDirection,
  type TaxRateOption
} from "./tax-mapping";

/** The tax facts of one document line. */
export type ProviderTaxLine = {
  taxCodeId: string | null;
  taxPercent: number;
  taxAmount: number;
};

/** No code, no rate, no tax: what every line was before tax codes. */
export function isUntaxedLine(line: ProviderTaxLine): boolean {
  return !line.taxCodeId && line.taxPercent === 0 && line.taxAmount === 0;
}

/** The company's tax-code facts a syncer needs besides the mappings. */
export type ProviderTaxCodeFacts = {
  /** Codes whose calculation type is Reverse Charge. */
  reverseChargeCodeIds: ReadonlySet<string>;
  /** Directions whose untaxed code-less lines send the fallback rate
   *  (`noTaxCodeFallbackDirections`). */
  noTaxCodeFallback: ReadonlySet<TaxDirection>;
};

/**
 * Does the line go out at the provider's "no tax" rate, with no mapping?
 * - A Reverse Charge purchase line: Phase 1 sends every Reverse Charge
 *   purchase document (bill, purchase order, supplier memo) tax-neutral.
 * - An untaxed code-less line, unless its direction sends the fallback.
 */
export function sendsProviderNoTax(
  line: ProviderTaxLine,
  direction: TaxDirection,
  facts: ProviderTaxCodeFacts | null
): boolean {
  if (
    direction === "purchase" &&
    line.taxCodeId &&
    facts?.reverseChargeCodeIds.has(line.taxCodeId)
  ) {
    return true;
  }
  return isUntaxedLine(line) && !facts?.noTaxCodeFallback.has(direction);
}

/**
 * The provider tax rate one document line goes out with. Shared by every
 * provider syncer that sends tax (Xero, QuickBooks Online).
 *
 * - A line with a Carbon tax code uses that code's mapping for the direction.
 *   An untaxed code-less line uses the fallback mapping when
 *   `noTaxCodeFallback` is set. No mapping, or a mapping to a rate the
 *   provider no longer offers (archived), refuses the document with the
 *   retryable Warning UNMAPPED_TAX_CODES.
 * - A legacy line (a bare `taxPercent`, no code) matches the percentage to
 *   one provider rate of the direction (`pickRateByPercent`). An untaxed
 *   legacy line takes the provider's `NONE` rate when it has one.
 * - The line's tax amount must be within one minor unit of
 *   net × the provider rate, so a code mapped to a rate with a different
 *   percentage is caught before the push, not on the VAT return.
 * - When the line's account class is known, the rate must apply to it.
 *
 * See .ai/specs/2026-10-16-multi-jurisdiction-tax.md (grills 8 and 9).
 */
export function resolveProviderTaxRate(args: {
  documentId: string;
  direction: TaxDirection;
  taxCodeId: string | null;
  taxPercent: number;
  netAmount: number;
  taxAmount: number;
  decimalPlaces: number;
  /** Keyed by `buildTaxCodeMappingEntityId`. */
  mappings: ReadonlyMap<string, TaxCodeMapping>;
  options: ReadonlyArray<TaxRateOption>;
  /** An untaxed code-less line resolves through the fallback mapping. */
  noTaxCodeFallback?: boolean;
  /** The class of the provider account the line posts to, when known. */
  account?: { code: string; class: ProviderAccountClass } | null;
}): {
  externalId: string;
  externalName: string;
  rate: number;
  option: TaxRateOption;
} {
  const fail = (
    reason: string,
    metadata: Record<string, unknown> = {},
    hint = "Map it on the integration's Tax Rates tab, then retry."
  ): never => {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_TAX_CODES",
      warning: true,
      message: `Cannot sync tax: ${reason}. ${hint}`,
      metadata: {
        documentId: args.documentId,
        taxCodeId: args.taxCodeId,
        direction: args.direction,
        reason,
        ...metadata
      }
    });
  };

  const options = args.options.filter((o) => o.direction === args.direction);
  const mappingId =
    args.taxCodeId ??
    (args.noTaxCodeFallback && isUntaxedLine(args)
      ? NO_TAX_CODE_MAPPING_ID
      : null);
  let option: TaxRateOption;

  if (mappingId) {
    const label = args.taxCodeId
      ? `tax code ${args.taxCodeId}`
      : "lines with no tax code (exempt or non-taxable)";
    const mapping = args.mappings.get(
      buildTaxCodeMappingEntityId(mappingId, args.direction)
    );
    if (!mapping) {
      return fail(`${label} has no ${args.direction} tax rate mapping`);
    }
    const found = options.find((o) => o.id === mapping.externalId);
    if (!found) {
      return fail(
        `${label} is mapped to ${mapping.externalName ?? mapping.externalId}, which the provider no longer offers as an active ${args.direction} rate (archived?); re-map it`,
        { externalId: mapping.externalId }
      );
    }
    option = found;
  } else {
    const none =
      args.taxPercent === 0
        ? options.find((o) => o.id === "NONE" && o.rate === 0)
        : undefined;
    const { match, candidates } = none
      ? { match: none, candidates: [none] }
      : pickRateByPercent(options, args.direction, args.taxPercent);
    if (!match) {
      return fail(
        candidates.length === 0
          ? `no ${args.direction} tax rate matches ${round(args.taxPercent * 100)}%`
          : `${candidates.length} ${args.direction} tax rates match ${round(args.taxPercent * 100)}%`,
        { candidateIds: candidates.map((c) => c.id) }
      );
    }
    option = match;
  }

  const expected = round(args.netAmount * option.rate, args.decimalPlaces);
  const minorUnit = 10 ** -args.decimalPlaces;
  if (Math.abs(args.taxAmount - expected) > minorUnit + EPSILON) {
    return fail(
      `the line's tax ${args.taxAmount} is not ${round(option.rate * 100)}% of ${args.netAmount} (${option.name} gives ${expected}); the Carbon rate is ${round(args.taxPercent * 100)}%`,
      { externalId: option.id, expected, taxAmount: args.taxAmount }
    );
  }

  if (args.account && option.canApplyTo?.[args.account.class] === false) {
    return fail(
      `${option.name} cannot be used on ${args.account.class} account ${args.account.code}`,
      {
        externalId: option.id,
        accountCode: args.account.code,
        accountClass: args.account.class
      },
      "Map the Carbon account to a provider account this rate applies to, or map the tax code to another rate, then retry."
    );
  }

  return {
    externalId: option.id,
    externalName: option.name,
    rate: option.rate,
    option
  };
}
