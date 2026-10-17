// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  distributeRoundingResidual,
  EPSILON,
  round,
  SCALE
} from "@carbon/utils";
import type { CostingLineTax } from "../../../core/document-costing";
import { JournalEntrySyncError } from "../../../core/posting";
import { resolveProviderTaxRate } from "../../../core/provider-tax";
import type {
  SalesDocumentComponent,
  SalesDocumentComponents
} from "../../../core/sales-document-components";
import {
  buildTaxCodeMappingLookup,
  type TaxCodeMapping,
  type TaxDirection,
  type TaxRateOption
} from "../../../core/tax-mapping";
import type { Qbo } from "../models";
import type { QboProvider } from "../provider";

export type QboInvoiceTaxCatalog = {
  country: string;
  taxCodes: readonly Qbo.TaxCode[];
  taxRates: readonly Qbo.TaxRate[];
};

/** Carbon tax code mappings, keyed by `buildTaxCodeMappingEntityId`. */
export type QboTaxCodeMappings = ReadonlyMap<string, TaxCodeMapping>;

/** Provider.query already paginates; one catalog promise is shared by a syncer batch. */
export async function loadQboInvoiceTaxCatalog(
  provider: QboProvider
): Promise<QboInvoiceTaxCatalog> {
  const [company, codes, rates] = await Promise.all([
    provider.getCompanyInfo(),
    provider.query<Qbo.TaxCode>("TaxCode"),
    provider.query<Qbo.TaxRate>("TaxRate")
  ]);
  if (!company?.Country || !/^[A-Z]{2}$/i.test(company.Country)) {
    throw new Error(
      "Cannot resolve QuickBooks tax jurisdiction: company country is missing"
    );
  }
  return {
    country: company.Country.toUpperCase(),
    taxCodes: codes.filter((code) => code.Active !== false),
    taxRates: rates.filter((rate) => rate.Active !== false)
  };
}

export function isQboUsCompany(catalog: QboInvoiceTaxCatalog): boolean {
  return catalog.country.toUpperCase() === "US";
}

/**
 * One syncer's tax reads: the QuickBooks catalog and the Carbon tax code
 * mappings, each read at most once and dropped again when the read fails, so
 * the next document retries it. A failed read is the retryable Warning
 * UNMAPPED_TAX_CODES.
 */
export class QboTaxContext {
  private catalogPromise?: Promise<QboInvoiceTaxCatalog>;
  private mappingsPromise?: Promise<QboTaxCodeMappings>;

  constructor(
    private readonly source: {
      catalog: () => Promise<QboInvoiceTaxCatalog>;
      mappings: () => Promise<{
        data: TaxCodeMapping[] | null;
        error: string | null;
      }>;
    }
  ) {}

  catalog(documentId: string): Promise<QboInvoiceTaxCatalog> {
    this.catalogPromise ??= this.source.catalog().catch((error) => {
      this.catalogPromise = undefined;
      throw error;
    });
    return this.catalogPromise.catch((error) => {
      throw unavailable(documentId, "Tax catalog unavailable", error);
    });
  }

  mappings(documentId: string): Promise<QboTaxCodeMappings> {
    this.mappingsPromise ??= this.source
      .mappings()
      .then(({ data, error }) => {
        if (error || !data) throw new Error(error ?? "no tax code mappings");
        return buildTaxCodeMappingLookup(data);
      })
      .catch((error) => {
        this.mappingsPromise = undefined;
        throw error;
      });
    return this.mappingsPromise.catch((error) => {
      throw unavailable(documentId, "Tax code mappings unavailable", error);
    });
  }
}

function unavailable(
  documentId: string,
  reason: string,
  error: unknown
): JournalEntrySyncError {
  return new JournalEntrySyncError({
    errorCode: "UNMAPPED_TAX_CODES",
    warning: true,
    message: `Cannot read QuickBooks tax configuration: ${error instanceof Error ? error.message : String(error)}`,
    metadata: { documentId, reason }
  });
}

function taxWarning(
  reason: string,
  metadata: Record<string, unknown>
): JournalEntrySyncError {
  return new JournalEntrySyncError({
    errorCode: "UNMAPPED_TAX_CODES",
    warning: true,
    message: `Cannot sync tax: ${reason}. Resolve the QuickBooks tax configuration or the integration's Tax Rates tab, then retry.`,
    metadata: { ...metadata, reason }
  });
}

function directionRates(
  code: Qbo.TaxCode,
  direction: TaxDirection
): NonNullable<Qbo.TaxCode["SalesTaxRateList"]>["TaxRateDetail"] {
  const list =
    direction === "sales" ? code.SalesTaxRateList : code.PurchaseTaxRateList;
  return list?.TaxRateDetail ?? [];
}

/**
 * The mapping tab's options from the QuickBooks catalog: a code with exactly
 * one rate in the direction's list (SalesTaxRateList for sales,
 * PurchaseTaxRateList for purchases). `RateValue` is in percent points; the
 * option rate is a 0..1 fraction. Tax groups are not offered.
 */
export function qboTaxOptions(
  catalog: Pick<QboInvoiceTaxCatalog, "taxCodes" | "taxRates">,
  direction: TaxDirection
): TaxRateOption[] {
  const rates = new Map(catalog.taxRates.map((rate) => [rate.Id, rate]));
  return catalog.taxCodes.flatMap((code) => {
    const details = directionRates(code, direction);
    if (code.TaxGroup || details.length !== 1) return [];
    const rate = rates.get(details[0]!.TaxRateRef.value);
    if (!rate) return [];
    return [
      {
        id: code.Id,
        name: code.Name ?? code.Id,
        rate: (rate.RateValue ?? 0) / 100,
        direction
      }
    ];
  });
}

/** An active single-rate code and its one rate in the direction's list. */
export function qboCodeRate(
  catalog: Pick<QboInvoiceTaxCatalog, "taxCodes" | "taxRates">,
  codeId: string,
  direction: TaxDirection
): { code: Qbo.TaxCode; rate: Qbo.TaxRate } | null {
  const code = catalog.taxCodes.find(
    (candidate) =>
      candidate.Id === codeId &&
      candidate.Active !== false &&
      !candidate.TaxGroup
  );
  if (!code) return null;
  const details = directionRates(code, direction);
  if (details.length !== 1) return null;
  const rate = catalog.taxRates.find(
    (candidate) =>
      candidate.Id === details[0]!.TaxRateRef.value &&
      candidate.Active !== false
  );
  if (!rate || !Number.isFinite(rate.RateValue)) return null;
  return { code, rate };
}

/** QuickBooks names its out-of-scope code these ways outside the US. */
const NON_TAXABLE_CODE_NAMES: ReadonlySet<string> = new Set([
  "no vat",
  "out of scope",
  "non"
]);

/**
 * The codes that could be the company's non-taxable code: a code QuickBooks
 * marks `Taxable: false` with no rate for the direction, else a code named
 * "No VAT" / "Out of Scope" / "NON" with no rate or a 0% rate.
 */
export function findQboNonTaxableCodes(
  catalog: Pick<QboInvoiceTaxCatalog, "taxCodes" | "taxRates">,
  direction: TaxDirection
): Qbo.TaxCode[] {
  const codes = catalog.taxCodes.filter(
    (code) => code.Active !== false && !code.TaxGroup
  );
  const rateless = codes.filter(
    (code) =>
      code.Taxable === false && directionRates(code, direction).length === 0
  );
  if (rateless.length > 0) return rateless;
  return codes.filter((code) => {
    if (!NON_TAXABLE_CODE_NAMES.has((code.Name ?? "").trim().toLowerCase()))
      return false;
    if (directionRates(code, direction).length === 0) return true;
    return qboCodeRate(catalog, code.Id, direction)?.rate.RateValue === 0;
  });
}

/**
 * The code an untaxed purchase line, or the non-recoverable remainder of a
 * bill line, goes out with outside the US. Exactly one candidate, else the
 * Warning — never a guess.
 */
export function qboNonTaxableCode(
  catalog: Pick<QboInvoiceTaxCatalog, "taxCodes" | "taxRates">,
  direction: TaxDirection,
  documentId: string
): Qbo.TaxCode {
  const candidates = findQboNonTaxableCodes(catalog, direction);
  if (candidates.length === 1) return candidates[0]!;
  throw taxWarning(
    candidates.length === 0
      ? `QuickBooks has no non-taxable ${direction} tax code (such as "No VAT") for untaxed amounts`
      : `QuickBooks has ${candidates.length} non-taxable ${direction} tax codes and Carbon cannot choose one for untaxed amounts`,
    {
      documentId,
      direction,
      candidateTaxCodeIds: candidates.map((code) => code.Id)
    }
  );
}

/**
 * The QuickBooks code one line goes out with: the mapped code of its Carbon
 * tax code, or for a legacy line the one rate matching its percentage
 * (`resolveProviderTaxRate`, which also checks the amount to one minor unit).
 * The code must still be an active single-rate code of the direction.
 */
export function resolveQboLineTax(args: {
  documentId: string;
  direction: TaxDirection;
  taxCodeId: string | null;
  taxPercent: number;
  netAmount: number;
  taxAmount: number;
  decimalPlaces: number;
  catalog: QboInvoiceTaxCatalog;
  mappings: QboTaxCodeMappings;
}): { code: Qbo.TaxCode; rate: Qbo.TaxRate } {
  const resolved = resolveProviderTaxRate({
    documentId: args.documentId,
    direction: args.direction,
    taxCodeId: args.taxCodeId,
    taxPercent: args.taxPercent,
    netAmount: args.netAmount,
    taxAmount: args.taxAmount,
    decimalPlaces: args.decimalPlaces,
    mappings: args.mappings,
    options: qboTaxOptions(args.catalog, args.direction)
  });
  const match = qboCodeRate(args.catalog, resolved.externalId, args.direction);
  if (!match) {
    throw taxWarning(
      `QuickBooks tax code ${resolved.externalName} is not an active single-rate ${args.direction} code`,
      {
        documentId: args.documentId,
        taxCodeId: args.taxCodeId,
        direction: args.direction,
        externalId: resolved.externalId
      }
    );
  }
  return match;
}

/**
 * `TxnTaxDetail` from resolved lines: one `TaxLine` per QuickBooks rate, and
 * `TotalTax` their sum. A line at a mapped 0% rate (zero-rated, exempt) keeps
 * its tax line, so its net reaches the return; a line at the non-taxable code
 * has no rate and no tax line. Undefined when no line has a rate.
 */
export function buildQboTxnTaxDetail(
  lines: ReadonlyArray<{
    rate: Qbo.TaxRate | null | undefined;
    netAmount: number;
    taxAmount: number;
  }>,
  decimalPlaces: number
): Qbo.TxnTaxDetail | undefined {
  const byRate = new Map<
    string,
    { rate: Qbo.TaxRate; amount: number; net: number }
  >();
  for (const line of lines) {
    if (!line.rate) continue;
    const total = byRate.get(line.rate.Id) ?? {
      rate: line.rate,
      amount: 0,
      net: 0
    };
    total.amount += line.taxAmount;
    total.net += line.netAmount;
    byRate.set(line.rate.Id, total);
  }
  if (byRate.size === 0) return undefined;
  const TaxLine = [...byRate.values()].map((total) => ({
    Amount: round(total.amount, decimalPlaces),
    DetailType: "TaxLineDetail" as const,
    TaxLineDetail: {
      TaxRateRef: { value: total.rate.Id },
      NetAmountTaxable: round(total.net, decimalPlaces),
      PercentBased: true as const,
      TaxPercent: round(total.rate.RateValue!)
    }
  }));
  return {
    TotalTax: round(
      TaxLine.reduce((sum, line) => sum + line.Amount, 0),
      decimalPlaces
    ),
    TaxLine
  };
}

/** The sales document shape the tax resolution reads. Invoices pass their
 *  components; a credit memo passes one component. */
export type QboTaxedSalesDocument = Pick<
  SalesDocumentComponents,
  "invoiceId" | "decimalPlaces" | "totalTax"
> & {
  components: ReadonlyArray<
    Pick<
      SalesDocumentComponent,
      "id" | "taxPercent" | "taxAmount" | "netAmount" | "taxCodeId"
    >
  >;
};

/**
 * Translate existing Carbon tax facts; never create tax codes or determine new
 * tax. A component with a Carbon tax code uses its mapped QuickBooks code; a
 * legacy component (no code) matches its percentage to the catalog.
 */
export function resolveQboInvoiceTax(args: {
  document: QboTaxedSalesDocument;
  catalog: QboInvoiceTaxCatalog;
  mappings?: QboTaxCodeMappings;
}): {
  lineTaxCodeRefs: ReadonlyMap<string, Qbo.Ref>;
  txnTaxDetail: Qbo.TxnTaxDetail | undefined;
} {
  const { document, catalog } = args;
  const mappings = args.mappings ?? new Map<string, TaxCodeMapping>();
  const requestedRates = [
    ...new Set(document.components.map((line) => line.taxPercent))
  ];
  const codes = catalog.taxCodes.filter((code) => code.Active !== false);
  const fail = (
    reason: string,
    candidates: readonly Qbo.TaxCode[] = codes
  ): never => {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_TAX_CODES",
      warning: true,
      message: `Cannot sync invoice tax (${requestedRates.map((rate) => `${round(rate * 100)}%`).join(", ")}): ${reason}. Resolve the QuickBooks tax configuration, then retry.`,
      metadata: {
        invoiceId: document.invoiceId,
        requestedRates,
        candidateTaxCodeIds: candidates.map((code) => code.Id),
        reason
      }
    });
  };
  if (!/^[A-Z]{2}$/i.test(catalog.country))
    fail("Company country/jurisdiction is missing");
  if (
    !Number.isInteger(document.decimalPlaces) ||
    document.decimalPlaces < 0 ||
    document.decimalPlaces > SCALE
  )
    fail("Invalid document tax precision");
  const isUS = isQboUsCompany(catalog);
  const rates = new Map(
    catalog.taxRates
      .filter((rate) => rate.Active !== false)
      .map((rate) => [rate.Id, rate])
  );
  // Legacy components (no Carbon tax code) match their percentage.
  const legacyRates = new Set(
    document.components
      .filter((line) => !line.taxCodeId)
      .map((line) => line.taxPercent)
  );
  const resolved = new Map<number, { code: Qbo.TaxCode; rate?: Qbo.TaxRate }>();
  for (const fraction of legacyRates) {
    if (!Number.isFinite(fraction) || fraction < 0)
      fail("Unsupported source fractional tax rate");
    if (fraction === 0 && isUS) continue;
    const percentage = round(fraction * 100);
    let candidates: Array<{ code: Qbo.TaxCode; rate?: Qbo.TaxRate }> = [];
    for (const code of codes) {
      const details = code.SalesTaxRateList?.TaxRateDetail ?? [];
      if (fraction === 0 && code.Taxable === false && details.length === 0) {
        candidates.push({ code });
        continue;
      }
      if (details.length !== 1) continue;
      const detail = details[0]!;
      if (
        (detail.TaxTypeApplicable &&
          detail.TaxTypeApplicable !== "TaxOnAmount") ||
        (detail.TaxOnTaxOrder != null && detail.TaxOnTaxOrder !== 0) ||
        (detail.TaxOrder != null && detail.TaxOrder > 1)
      )
        continue;
      const rate = rates.get(detail.TaxRateRef.value);
      if (
        !rate ||
        !Number.isFinite(rate.RateValue) ||
        (rate.EffectiveTaxRate?.length ?? 0) > 0 ||
        rate.SpecialTaxType
      )
        continue;
      if (Math.abs(round(rate.RateValue!) - percentage) <= EPSILON)
        candidates.push({ code, rate });
    }
    // Several 0% codes (zero-rated, exempt, no VAT): an untaxed amount takes
    // the company's non-taxable code when it is one of them.
    if (fraction === 0 && candidates.length > 1) {
      const nonTaxable = findQboNonTaxableCodes(catalog, "sales");
      const preferred = candidates.filter(
        (match) =>
          nonTaxable.length === 1 && match.code.Id === nonTaxable[0]!.Id
      );
      if (preferred.length === 1) candidates = preferred;
    }
    if (candidates.length !== 1)
      fail(
        candidates.length === 0
          ? `No supported simple active sales tax code reproduces ${percentage}% (missing, compound, dated, or purchase-only configuration)`
          : `Multiple active sales tax codes match ${percentage}%`,
        candidates.map((match) => match.code)
      );
    resolved.set(fraction, candidates[0]!);
  }
  // US line refs are protocol markers, not query-returned TaxCode IDs.
  // Intuit's SDK quickstart documents TAX/NON; transaction rates still come
  // from the actual catalog resolved above.
  const marker = (taxable: boolean): Qbo.Ref => ({
    value: taxable ? "TAX" : "NON"
  });
  const lineTaxCodeRefs = new Map<string, Qbo.Ref>();
  const taxLines: Array<{
    rate: Qbo.TaxRate | undefined;
    netAmount: number;
    taxAmount: number;
  }> = [];
  const transactionCodes = new Map<string, Qbo.TaxCode>();
  for (const line of document.components) {
    if (!Number.isFinite(line.taxAmount) || !Number.isFinite(line.netAmount))
      fail("Non-finite document tax component");
    const taxCodeId = line.taxCodeId;
    const match = taxCodeId
      ? resolveQboLineTax({
          documentId: document.invoiceId,
          direction: "sales",
          taxCodeId,
          taxPercent: line.taxPercent,
          netAmount: line.netAmount,
          taxAmount: line.taxAmount,
          decimalPlaces: document.decimalPlaces,
          catalog,
          mappings
        })
      : resolved.get(line.taxPercent);
    const codeRef = isUS
      ? marker(line.taxPercent !== 0)
      : { value: match!.code.Id };
    lineTaxCodeRefs.set(line.id, codeRef);
    const expected = round(
      line.netAmount * line.taxPercent,
      document.decimalPlaces
    );
    const envelope = 1 / 10 ** document.decimalPlaces + EPSILON;
    if (
      Math.abs(expected - line.taxAmount) > envelope ||
      (line.taxPercent === 0 && line.taxAmount !== 0)
    ) {
      fail(
        `Supplied tax on component ${line.id} cannot be reproduced by its percentage`
      );
    }
    // An untaxed legacy amount carries no tax line; a mapped 0% code keeps
    // one outside the US, so its net reaches the return.
    if (line.taxPercent === 0 && (!taxCodeId || isUS)) continue;
    if (line.taxPercent !== 0)
      transactionCodes.set(match!.code.Id, match!.code);
    taxLines.push({
      rate: match!.rate,
      netAmount: line.netAmount,
      taxAmount: line.taxAmount
    });
  }
  if (isUS && transactionCodes.size > 1)
    fail("US invoices support only one transaction tax code", [
      ...transactionCodes.values()
    ]);
  const detail = buildQboTxnTaxDetail(taxLines, document.decimalPlaces);
  const totalTax = detail?.TotalTax ?? 0;
  if (
    !Number.isFinite(document.totalTax) ||
    Math.abs(totalTax - document.totalTax) > EPSILON
  )
    fail("Native tax detail does not reconcile to the document tax total");
  if (!detail) return { lineTaxCodeRefs, txnTaxDetail: undefined };
  const [transactionCode] = transactionCodes.values();
  return {
    lineTaxCodeRefs,
    txnTaxDetail: {
      ...(isUS && transactionCode
        ? { TxnTaxCodeRef: { value: transactionCode.Id } }
        : {}),
      TotalTax: document.totalTax,
      TaxLine: detail.TaxLine
    }
  };
}

/** One purchase amount, before its tax is resolved. */
export type QboPurchaseTaxSource = {
  id: string;
  /** Document currency. Includes the line's non-recoverable tax. */
  amount: number;
  tax: CostingLineTax | null | undefined;
};

/** One provider line of a purchase amount. */
export type QboPurchaseTaxPart = {
  sourceId: string;
  amount: number;
  codeRef: Qbo.Ref;
  rate: Qbo.TaxRate | null;
  taxAmount: number;
};

/**
 * The QuickBooks lines of purchase amounts outside the US. QuickBooks takes
 * one tax code per line, so per amount L at rate r with recoverable share s:
 * - recoverable tax (r·s ≠ 0): the base is L / (1 + r·(1 − s)), since L holds
 *   the non-recoverable tax. Line 1 is base · s at the mapped code with the
 *   recoverable tax; line 2 is the rest of L at the company's non-taxable
 *   code (grill 10). A fully recoverable amount is line 1 alone.
 * - a code at 0% (zero-rated, exempt): its mapped code with no tax, so its net
 *   reaches the return.
 * - tax folded into cost (r ≠ 0, s = 0), or no tax and no code: the
 *   non-taxable code.
 * - tax that cannot be tied to one code: refused when the document has
 *   recoverable tax; otherwise it moves no tax, and takes the non-taxable code.
 * The recoverable tax of the lines sums exactly to `recoverableTax` (the
 * posted Tax Paid legs): each line takes at most one minor unit of the
 * residual.
 */
export function splitQboPurchaseTax(args: {
  documentId: string;
  sources: ReadonlyArray<QboPurchaseTaxSource>;
  /** Document currency. */
  recoverableTax: number;
  decimalPlaces: number;
  catalog: QboInvoiceTaxCatalog;
  mappings: QboTaxCodeMappings;
}): QboPurchaseTaxPart[] {
  const { documentId, decimalPlaces } = args;
  const unresolved = args.sources.filter((source) => !source.tax);
  if (unresolved.length > 0 && args.recoverableTax !== 0) {
    throw taxWarning(
      `${unresolved.length} line(s) cannot be tied to one tax code of the invoice, so their recoverable tax cannot be sent`,
      { documentId, lineIds: unresolved.map((source) => source.id) }
    );
  }
  const plans = args.sources.map((source) => {
    const tax = source.tax ?? null;
    if (!tax)
      return { source, tax, kind: "untaxed" as const, net: 0, exact: 0 };
    const recoverableRate = tax.taxPercent * tax.recoverableShare;
    const base =
      source.amount / (1 + tax.taxPercent * (1 - tax.recoverableShare));
    return {
      source,
      tax,
      kind:
        recoverableRate !== 0
          ? ("recoverable" as const)
          : tax.taxCodeId && tax.taxPercent === 0
            ? ("zeroRated" as const)
            : ("untaxed" as const),
      net: round(base * tax.recoverableShare, decimalPlaces),
      exact: base * recoverableRate
    };
  });
  const recoverable = plans.filter((plan) => plan.kind === "recoverable");
  if (recoverable.length === 0 && args.recoverableTax !== 0) {
    throw taxWarning(
      "the bill posted recoverable tax, but none of its lines has a recoverable tax code",
      { documentId, recoverableTax: args.recoverableTax }
    );
  }
  let taxes: number[];
  try {
    taxes = distributeRoundingResidual(
      recoverable.map((plan) => plan.exact),
      args.recoverableTax,
      decimalPlaces
    );
  } catch {
    throw taxWarning(
      `the lines' recoverable tax does not reconcile to the ${args.recoverableTax} posted to Tax Paid`,
      { documentId, recoverableTax: args.recoverableTax }
    );
  }
  const taxBySource = new Map(
    recoverable.map((plan, index) => [plan.source.id, taxes[index]!])
  );

  let nonTaxable: Qbo.Ref | undefined;
  const nonTaxableRef = () =>
    (nonTaxable ??= {
      value: qboNonTaxableCode(args.catalog, "purchase", documentId).Id
    });
  const mapped = (tax: CostingLineTax, netAmount: number, taxAmount: number) =>
    resolveQboLineTax({
      documentId,
      direction: "purchase",
      taxCodeId: tax.taxCodeId,
      taxPercent: tax.taxPercent,
      netAmount,
      taxAmount,
      decimalPlaces,
      catalog: args.catalog,
      mappings: args.mappings
    });
  const parts: QboPurchaseTaxPart[] = [];
  for (const plan of plans) {
    const { source } = plan;
    if (plan.kind === "zeroRated") {
      const match = mapped(plan.tax!, source.amount, 0);
      parts.push({
        sourceId: source.id,
        amount: source.amount,
        codeRef: { value: match.code.Id },
        rate: match.rate,
        taxAmount: 0
      });
      continue;
    }
    let rest = source.amount;
    if (plan.kind === "recoverable") {
      const taxAmount = taxBySource.get(source.id)!;
      const match = mapped(plan.tax!, plan.net, taxAmount);
      parts.push({
        sourceId: source.id,
        amount: plan.net,
        codeRef: { value: match.code.Id },
        rate: match.rate,
        taxAmount
      });
      rest = round(source.amount - plan.net, decimalPlaces);
      if (rest === 0) continue;
    }
    parts.push({
      sourceId: source.id,
      amount: rest,
      codeRef: nonTaxableRef(),
      rate: null,
      taxAmount: 0
    });
  }
  return parts;
}
