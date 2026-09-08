import { EPSILON, round, SCALE } from "@carbon/utils";
import { JournalEntrySyncError } from "../../../core/posting";
import type { SalesDocumentComponents } from "../../../core/sales-document-components";
import type { Qbo } from "../models";
import type { QboProvider } from "../provider";

export type QboInvoiceTaxCatalog = {
  country: string;
  taxCodes: readonly Qbo.TaxCode[];
  taxRates: readonly Qbo.TaxRate[];
};

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

/** Translate existing Carbon tax facts; never create tax codes or determine new tax. */
export function resolveQboInvoiceTax(args: {
  document: SalesDocumentComponents;
  catalog: QboInvoiceTaxCatalog;
}): {
  lineTaxCodeRefs: ReadonlyMap<string, Qbo.Ref>;
  txnTaxDetail: Qbo.TxnTaxDetail | undefined;
} {
  const { document, catalog } = args;
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
  const isUS = catalog.country.toUpperCase() === "US";
  const rates = new Map(
    catalog.taxRates
      .filter((rate) => rate.Active !== false)
      .map((rate) => [rate.Id, rate])
  );
  const resolved = new Map<number, { code: Qbo.TaxCode; rate?: Qbo.TaxRate }>();
  for (const fraction of requestedRates) {
    if (!Number.isFinite(fraction) || fraction < 0)
      fail("Unsupported source fractional tax rate");
    if (fraction === 0 && isUS) continue;
    const percentage = round(fraction * 100);
    const candidates: Array<{ code: Qbo.TaxCode; rate?: Qbo.TaxRate }> = [];
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
    if (candidates.length !== 1)
      fail(
        candidates.length === 0
          ? `No supported simple active sales tax code reproduces ${percentage}% (missing, compound, dated, or purchase-only configuration)`
          : `Multiple active sales tax codes match ${percentage}%`,
        candidates.map((match) => match.code)
      );
    resolved.set(fraction, candidates[0]!);
  }
  const nonzero = [...resolved]
    .filter(([fraction]) => fraction !== 0)
    .map(([, match]) => match);
  if (isUS && new Set(nonzero.map((match) => match.code.Id)).size > 1)
    fail("US invoices support only one transaction tax code");
  const marker = (taxable: boolean): Qbo.Ref => {
    // These are provider catalog identities, not synthesized numeric tax IDs.
    const matches = codes.filter(
      (code) =>
        code.Id === (taxable ? "TAX" : "NON") && code.Taxable !== !taxable
    );
    if (matches.length !== 1)
      fail(
        `Missing or ambiguous US ${taxable ? "taxable" : "non-taxable"} line marker`,
        matches
      );
    return { value: matches[0]!.Id };
  };
  const lineTaxCodeRefs = new Map<string, Qbo.Ref>();
  const nativeByRate = new Map<
    string,
    { amount: number; net: number; percentage: number }
  >();
  for (const line of document.components) {
    if (!Number.isFinite(line.taxAmount) || !Number.isFinite(line.netAmount))
      fail("Non-finite document tax component");
    const match = resolved.get(line.taxPercent);
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
    if (line.taxPercent === 0) continue;
    const rateId = match!.rate!.Id;
    const total = nativeByRate.get(rateId) ?? {
      amount: 0,
      net: 0,
      percentage: round(line.taxPercent * 100)
    };
    total.amount += line.taxAmount;
    total.net += line.netAmount;
    nativeByRate.set(rateId, total);
  }
  const totalTax = round(
    [...nativeByRate.values()].reduce((sum, row) => sum + row.amount, 0),
    document.decimalPlaces
  );
  if (
    !Number.isFinite(document.totalTax) ||
    Math.abs(totalTax - document.totalTax) > EPSILON
  )
    fail("Native tax detail does not reconcile to the document tax total");
  if (nativeByRate.size === 0)
    return { lineTaxCodeRefs, txnTaxDetail: undefined };
  return {
    lineTaxCodeRefs,
    txnTaxDetail: {
      ...(isUS && nonzero[0]
        ? { TxnTaxCodeRef: { value: nonzero[0].code.Id } }
        : {}),
      TotalTax: document.totalTax,
      TaxLine: [...nativeByRate].map(([id, total]) => ({
        Amount: round(total.amount, document.decimalPlaces),
        DetailType: "TaxLineDetail",
        TaxLineDetail: {
          TaxRateRef: { value: id },
          NetAmountTaxable: round(total.net, document.decimalPlaces),
          PercentBased: true,
          TaxPercent: total.percentage
        }
      }))
    }
  };
}
