// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { resolveProviderTaxRate } from "../../core/provider-tax";
import {
  buildTaxCodeMappingLookup,
  getTaxCodeMappings,
  type TaxCodeMapping,
  type TaxDirection,
  type TaxRateOption
} from "../../core/tax-mapping";
import { toXeroTaxRateOptions, type XeroProvider } from "./provider";

/**
 * The Xero side of the tax-code mapping: what a syncer needs to turn a Carbon
 * line's tax into a Xero `TaxType`. Loaded once per syncer (the
 * `taxContextPromise` on each), and only when a document has a taxed line.
 * See .ai/specs/2026-10-16-multi-jurisdiction-tax.md (grills 8 and 9).
 */
export type XeroTaxContext = {
  /** Keyed by `buildTaxCodeMappingEntityId`. */
  mappings: ReadonlyMap<string, TaxCodeMapping>;
  options: ReadonlyArray<TaxRateOption>;
};

/** Xero's "no tax" rate — what an untaxed line has always been sent with. */
export const XERO_NO_TAX = "NONE";

type TaxedLine = {
  taxCodeId: string | null;
  taxPercent: number;
  taxAmount: number;
};

/**
 * An untaxed legacy line: no code, no rate, no tax. It goes out as `NONE`
 * without reading the catalog, which is the answer `resolveProviderTaxRate`
 * gives it too — so a company with no tax codes sends what it sent before,
 * and never waits on GET /TaxRates.
 */
function isUntaxedLegacyLine(line: TaxedLine): boolean {
  return !line.taxCodeId && line.taxPercent === 0 && line.taxAmount === 0;
}

/** Does any line need the tax context to resolve its `TaxType`? */
export function needsXeroTaxContext(lines: ReadonlyArray<TaxedLine>): boolean {
  return lines.some((line) => !isUntaxedLegacyLine(line));
}

/**
 * The tax-code mappings and the organisation's active tax rates. GET
 * /TaxRates answers [] on failure (its settings-tab contract), and an
 * organisation always has active rates, so an empty catalog is refused here:
 * the syncer's cache drops a failed load, and the next document reads again.
 */
export async function loadXeroTaxContext(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; integration: string },
  provider: Pick<XeroProvider, "listTaxRates">
): Promise<XeroTaxContext> {
  const [mappings, rates] = await Promise.all([
    getTaxCodeMappings(db, args),
    provider.listTaxRates()
  ]);
  if (mappings.error) {
    throw new Error(`Failed to load Xero tax-rate mappings: ${mappings.error}`);
  }
  if (rates.length === 0) {
    throw new Error("Failed to load the Xero organisation's tax rates");
  }
  return {
    mappings: buildTaxCodeMappingLookup(mappings.data ?? []),
    options: toXeroTaxRateOptions(rates)
  };
}

/**
 * The `TaxType` one Xero line goes out with. An untaxed legacy line is
 * `NONE`; every other line goes through `resolveProviderTaxRate`, which
 * raises the retryable UNMAPPED_TAX_CODES Warning for an unmapped code, an
 * ambiguous legacy percent, or a tax amount the mapped rate does not give.
 */
export function resolveXeroTaxType(args: {
  context: XeroTaxContext | null;
  documentId: string;
  direction: TaxDirection;
  taxCodeId: string | null;
  taxPercent: number;
  netAmount: number;
  taxAmount: number;
  /** The document currency's decimals; null only fails a taxed line. */
  decimalPlaces: number | null;
}): string {
  if (isUntaxedLegacyLine(args)) return XERO_NO_TAX;
  if (!args.context) {
    throw new Error(
      `Document ${args.documentId} has a taxed line but no Xero tax context was loaded`
    );
  }
  if (args.decimalPlaces === null) {
    throw new Error(
      `Document ${args.documentId} has a taxed line but its currency has no decimal places`
    );
  }
  return resolveProviderTaxRate({
    documentId: args.documentId,
    direction: args.direction,
    taxCodeId: args.taxCodeId,
    taxPercent: args.taxPercent,
    netAmount: args.netAmount,
    taxAmount: args.taxAmount,
    decimalPlaces: args.decimalPlaces,
    mappings: args.context.mappings,
    options: args.context.options
  }).externalId;
}

/** Does any line carry a mapped rate (anything but `NONE`)? Such a document
 *  states its line amounts exclusive of tax. */
export function hasXeroMappedTax(
  lines: ReadonlyArray<{ TaxType?: string }>
): boolean {
  return lines.some(
    (line) => line.TaxType !== undefined && line.TaxType !== XERO_NO_TAX
  );
}
