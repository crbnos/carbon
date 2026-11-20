// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  type ProviderTaxCodeFacts,
  type ProviderTaxLine,
  resolveProviderTaxRate,
  sendsProviderNoTax
} from "../../core/provider-tax";
import {
  buildTaxCodeMappingLookup,
  getTaxCodeMappings,
  loadTaxCodeUsage,
  noTaxCodeFallbackDirections,
  type ProviderAccountClass,
  type TaxCodeMapping,
  type TaxDirection,
  type TaxRateOption
} from "../../core/tax-mapping";
import { toXeroTaxRateOptions, type XeroProvider } from "./provider";

/**
 * The Xero side of the tax-code mapping: what a syncer needs to turn a Carbon
 * line's tax into a Xero `TaxType`. Each syncer owns one
 * `XeroTaxContextLoader`; the catalog is read only when a document has a line
 * that needs a mapped rate.
 * See .ai/specs/2026-10-16-multi-jurisdiction-tax.md (grills 8 and 9).
 */
export type XeroTaxContext = ProviderTaxCodeFacts & {
  /** False when no line of the document needs a mapped rate: the catalog,
   *  mappings and chart were not read. */
  catalogLoaded: boolean;
  /** Keyed by `buildTaxCodeMappingEntityId`. */
  mappings: ReadonlyMap<string, TaxCodeMapping>;
  options: ReadonlyArray<TaxRateOption>;
  /** Xero account code → its class, for the rate's `CanApplyTo*` check. */
  accountClassByCode: ReadonlyMap<string, ProviderAccountClass>;
};

/** Xero's "no tax" rate — what an untaxed line has always been sent with. */
export const XERO_NO_TAX = "NONE";

const XERO_ACCOUNT_CLASSES: Record<string, ProviderAccountClass> = {
  ASSET: "asset",
  EQUITY: "equity",
  EXPENSE: "expense",
  LIABILITY: "liability",
  REVENUE: "revenue"
};

type XeroTaxReads = Pick<XeroProvider, "listTaxRates" | "listChartOfAccounts">;

/**
 * One syncer's tax reads, each memoized and dropped again when it fails, so
 * the next document retries:
 * - the company's tax-code facts (Reverse Charge codes, which directions use
 *   codes), one DB statement;
 * - the mappings, the organisation's active tax rates and its chart of
 *   accounts, only when a line needs a mapped rate.
 */
export class XeroTaxContextLoader {
  private factsPromise?: Promise<ProviderTaxCodeFacts>;
  private catalogPromise?: Promise<XeroTaxContext>;

  constructor(
    private readonly db: Kysely<KyselyDatabase>,
    private readonly args: { companyId: string; integration: string },
    private readonly provider: XeroTaxReads
  ) {}

  facts(): Promise<ProviderTaxCodeFacts> {
    this.factsPromise ??= loadTaxCodeUsage(this.db, this.args.companyId)
      .then((usage) => ({
        reverseChargeCodeIds: new Set(
          usage.filter((code) => code.reverseCharge).map((code) => code.id)
        ),
        noTaxCodeFallback: noTaxCodeFallbackDirections(usage)
      }))
      .catch((error) => {
        this.factsPromise = undefined;
        throw error;
      });
    return this.factsPromise;
  }

  private catalog(): Promise<XeroTaxContext> {
    this.catalogPromise ??= loadXeroTaxContext(
      this.db,
      this.args,
      this.provider,
      this.facts()
    ).catch((error) => {
      this.catalogPromise = undefined;
      throw error;
    });
    return this.catalogPromise;
  }

  /** The context for a document's lines: the full catalog when any line
   *  needs a mapped rate, else only the facts. */
  async forLines(
    direction: TaxDirection,
    lines: ReadonlyArray<ProviderTaxLine>
  ): Promise<XeroTaxContext> {
    const facts = await this.facts();
    if (lines.some((line) => !sendsProviderNoTax(line, direction, facts))) {
      return this.catalog();
    }
    return {
      ...facts,
      catalogLoaded: false,
      mappings: new Map(),
      options: [],
      accountClassByCode: new Map()
    };
  }

  /** The full context, whatever the lines. */
  load(): Promise<XeroTaxContext> {
    return this.catalog();
  }
}

/**
 * The tax-code mappings, the organisation's active tax rates and its chart.
 * GET /TaxRates answers [] on failure (its settings-tab contract), and an
 * organisation always has active rates, so an empty catalog is refused here.
 * An empty chart only skips the account-class check.
 */
async function loadXeroTaxContext(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; integration: string },
  provider: XeroTaxReads,
  factsPromise: Promise<ProviderTaxCodeFacts>
): Promise<XeroTaxContext> {
  const [mappings, rates, chart, facts] = await Promise.all([
    getTaxCodeMappings(db, args),
    provider.listTaxRates(),
    provider.listChartOfAccounts(),
    factsPromise
  ]);
  if (mappings.error) {
    throw new Error(`Failed to load Xero tax-rate mappings: ${mappings.error}`);
  }
  if (rates.length === 0) {
    throw new Error("Failed to load the Xero organisation's tax rates");
  }
  const accountClassByCode = new Map<string, ProviderAccountClass>();
  for (const account of chart) {
    const accountClass = XERO_ACCOUNT_CLASSES[account.Class ?? ""];
    if (account.Code && accountClass) {
      accountClassByCode.set(account.Code, accountClass);
    }
  }
  return {
    ...facts,
    catalogLoaded: true,
    mappings: buildTaxCodeMappingLookup(mappings.data ?? []),
    options: toXeroTaxRateOptions(rates),
    accountClassByCode
  };
}

/**
 * The `TaxType` one Xero line goes out with. `NONE` for a line
 * `sendsProviderNoTax` names (an untaxed line with no fallback, a Reverse
 * Charge purchase line). Every other line goes through
 * `resolveProviderTaxRate`, which raises the retryable UNMAPPED_TAX_CODES
 * Warning for an unmapped or archived mapping, an ambiguous legacy percent,
 * a tax amount the mapped rate does not give, or a rate Xero cannot apply to
 * the line's account class.
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
  /** The line's Xero account code, for the account-class check. */
  accountCode?: string | null;
}): string {
  if (sendsProviderNoTax(args, args.direction, args.context)) {
    return XERO_NO_TAX;
  }
  if (!args.context?.catalogLoaded) {
    throw new Error(
      `Document ${args.documentId} has a taxed line but no Xero tax context was loaded`
    );
  }
  if (args.decimalPlaces === null) {
    throw new Error(
      `Document ${args.documentId} has a taxed line but its currency has no decimal places`
    );
  }
  const accountClass = args.accountCode
    ? args.context.accountClassByCode.get(args.accountCode)
    : undefined;
  return resolveProviderTaxRate({
    documentId: args.documentId,
    direction: args.direction,
    taxCodeId: args.taxCodeId,
    taxPercent: args.taxPercent,
    netAmount: args.netAmount,
    taxAmount: args.taxAmount,
    decimalPlaces: args.decimalPlaces,
    mappings: args.context.mappings,
    options: args.context.options,
    noTaxCodeFallback: args.context.noTaxCodeFallback.has(args.direction),
    account:
      args.accountCode && accountClass
        ? { code: args.accountCode, class: accountClass }
        : null
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
