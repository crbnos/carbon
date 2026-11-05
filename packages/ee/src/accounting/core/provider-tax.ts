// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { EPSILON, round } from "@carbon/utils";
import { JournalEntrySyncError } from "./posting";
import {
  buildTaxCodeMappingEntityId,
  type TaxCodeMapping,
  type TaxDirection,
  type TaxRateOption
} from "./tax-mapping";

/**
 * The provider tax rate one document line goes out with. Shared by every
 * provider syncer that sends tax (Xero, QuickBooks Online).
 *
 * - A line with a Carbon tax code uses that code's mapping for the direction.
 *   No mapping refuses the document with the retryable Warning
 *   UNMAPPED_TAX_CODES, naming the code.
 * - A legacy line (a bare `taxPercent`, no code) matches the percentage to
 *   exactly one provider rate of the direction. An untaxed legacy line takes
 *   the provider's `NONE` rate when it has one.
 * - The line's tax amount must be within one minor unit of
 *   net × the provider rate, so a code mapped to a rate with a different
 *   percentage is caught before the push, not on the VAT return.
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
}): { externalId: string; externalName: string; rate: number } {
  const fail = (reason: string, metadata: Record<string, unknown> = {}) => {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_TAX_CODES",
      warning: true,
      message: `Cannot sync tax: ${reason}. Map it on the integration's Tax Rates tab, then retry.`,
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
  let resolved: { externalId: string; externalName: string; rate: number };

  if (args.taxCodeId) {
    const mapping = args.mappings.get(
      buildTaxCodeMappingEntityId(args.taxCodeId, args.direction)
    );
    if (!mapping) {
      return fail(
        `tax code ${args.taxCodeId} has no ${args.direction} tax rate mapping`
      );
    }
    const option = options.find((o) => o.id === mapping.externalId);
    resolved = {
      externalId: mapping.externalId,
      externalName: mapping.externalName ?? option?.name ?? mapping.externalId,
      rate: option?.rate ?? mapping.externalRate ?? args.taxPercent
    };
  } else {
    const none =
      args.taxPercent === 0
        ? options.find((o) => o.id === "NONE" && o.rate === 0)
        : undefined;
    const candidates = none
      ? [none]
      : options.filter((o) => Math.abs(o.rate - args.taxPercent) <= EPSILON);
    if (candidates.length !== 1) {
      return fail(
        candidates.length === 0
          ? `no ${args.direction} tax rate matches ${round(args.taxPercent * 100)}%`
          : `${candidates.length} ${args.direction} tax rates match ${round(args.taxPercent * 100)}%`,
        { candidateIds: candidates.map((c) => c.id) }
      );
    }
    const [match] = candidates;
    resolved = {
      externalId: match!.id,
      externalName: match!.name,
      rate: match!.rate
    };
  }

  const expected = round(args.netAmount * resolved.rate, args.decimalPlaces);
  const minorUnit = 10 ** -args.decimalPlaces;
  if (Math.abs(args.taxAmount - expected) > minorUnit + EPSILON) {
    return fail(
      `the line's tax ${args.taxAmount} is not ${round(resolved.rate * 100)}% of ${args.netAmount} (${resolved.externalName} gives ${expected}); the Carbon rate is ${round(args.taxPercent * 100)}%`,
      { externalId: resolved.externalId, expected, taxAmount: args.taxAmount }
    );
  }
  return resolved;
}
