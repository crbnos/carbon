import {
  allocateSalesHeaderShipping,
  assertExchangeRate,
  calculateSalesPostingAmounts,
  distributeRoundingResidual,
  EPSILON,
  round,
  SCALE,
  toDocumentAmount
} from "@carbon/utils";
import type { Accounting } from "./types";

export type SalesDocumentComponent = {
  id: string;
  sourceLineId: string | null;
  kind:
    | "Merchandise"
    | "TaxableAddOn"
    | "NonTaxableAddOn"
    | "LineShipping"
    | "HeaderShipping";
  itemId: string | null;
  itemCode: string | null;
  description: string;
  quantity: number;
  unitAmount: number;
  netAmount: number;
  taxPercent: number;
  taxAmount: number;
};

export type SalesDocumentComponents = {
  invoiceId: string;
  currencyCode: string;
  decimalPlaces: number;
  components: SalesDocumentComponent[];
  subtotal: number;
  totalTax: number;
  totalAmount: number;
  balance: number;
};

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function precision(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > SCALE) {
    throw new Error("Missing or unsupported currency decimal precision");
  }
}

export function buildSalesDocumentComponents(
  invoice: Accounting.SalesInvoice
): SalesDocumentComponents {
  const source = invoice;
  if (!source.currencyCode?.trim() || !source.baseCurrencyCode?.trim()) {
    throw new Error("Missing invoice currency metadata");
  }
  precision(source.currencyDecimalPlaces);
  precision(source.baseCurrencyDecimalPlaces);
  const decimals = source.currencyDecimalPlaces;
  const rate = source.exchangeRate;
  assertExchangeRate(rate);
  if (source.currencyCode === source.baseCurrencyCode && rate !== 1) {
    throw new Error("Base-currency invoices require an identity exchange rate");
  }
  const header = finite(source.headerShippingCost, "Header shipping");
  const lines = source.lines.filter(
    (line) => line.invoiceLineType !== "Comment"
  );
  if (new Set(lines.map((line) => line.id)).size !== lines.length) {
    throw new Error("Invoice source line IDs must be unique");
  }
  const headerAllocations = allocateSalesHeaderShipping(lines, header);
  const baseAmounts = lines.map((line) =>
    calculateSalesPostingAmounts({
      ...line,
      allocatedHeaderShipping: headerAllocations.get(line.id) ?? 0
    })
  );
  const sourceEnvelope = (lines.length * 4 + 1) / (2 * 10 ** SCALE) + EPSILON;
  const reconcileSource = (actual: number, expected: number, label: string) => {
    finite(actual, label);
    finite(expected, label);
    if (Math.abs(actual - expected) > sourceEnvelope) {
      throw new Error(
        `Invoice ${label} does not reconcile with its source components`
      );
    }
  };
  reconcileSource(
    baseAmounts.reduce(
      (sum, value) => sum + value.salesRevenueBase + value.shippingRevenueBase,
      0
    ),
    source.subtotal + header,
    "subtotal"
  );
  reconcileSource(
    baseAmounts.reduce((sum, value) => sum + value.salesTaxBase, 0),
    source.totalTax,
    "tax total"
  );
  reconcileSource(
    source.subtotal + header + source.totalTax,
    source.totalAmount,
    "gross total"
  );

  type RawComponent = {
    component: SalesDocumentComponent;
    baseNet: number;
    baseTax: number;
  };
  const raw: RawComponent[] = [];
  const push = (args: {
    kind: SalesDocumentComponent["kind"];
    line?: Accounting.SalesInvoiceLine;
    baseNet: number;
    taxPercent: number;
    description: string;
    quantity?: number;
  }) => {
    const { line, kind, baseNet, taxPercent } = args;
    const baseTax = finite(baseNet * taxPercent, "Component tax");
    if (baseNet === 0 && baseTax === 0) return;
    const quantity = args.quantity ?? 1;
    let unitAmount = toDocumentAmount(baseNet, rate, decimals);
    if (kind === "Merchandise" && line) {
      const convertedUnit = line.convertedUnitPrice;
      const expectedUnit = finite(line.unitPrice * rate, "Document unit price");
      if (
        convertedUnit != null &&
        Math.abs(
          finite(convertedUnit, "Document price mirror") - expectedUnit
        ) >
          1 / (2 * 10 ** SCALE) + EPSILON
      ) {
        throw new Error(
          `Invoice line ${line.id} price mirror contradicts its exchange rate`
        );
      }
      unitAmount =
        convertedUnit ?? toDocumentAmount(line.unitPrice, rate, SCALE);
    }
    raw.push({
      baseNet,
      baseTax,
      component: {
        id: `${line?.id ?? source.id}:${kind}`,
        sourceLineId: line?.id ?? null,
        kind,
        itemId: line?.itemId ?? null,
        itemCode: line?.itemCode ?? null,
        description: args.description,
        quantity,
        unitAmount,
        netAmount: toDocumentAmount(baseNet, rate, decimals),
        taxPercent,
        taxAmount: toDocumentAmount(baseTax, rate, decimals)
      }
    });
  };
  for (const line of lines) {
    push({
      kind: "Merchandise",
      line,
      baseNet: line.quantity * line.unitPrice,
      taxPercent: line.taxPercent,
      quantity: line.quantity,
      description: line.description ?? line.itemCode ?? "Invoice line"
    });
    push({
      kind: "TaxableAddOn",
      line,
      baseNet: line.addOnCost ?? 0,
      taxPercent: line.taxPercent,
      description: `Add-on — ${line.description ?? line.itemCode ?? "Invoice line"}`
    });
    push({
      kind: "NonTaxableAddOn",
      line,
      baseNet: line.nonTaxableAddOnCost ?? 0,
      taxPercent: 0,
      description: `Non-taxable add-on — ${line.description ?? line.itemCode ?? "Invoice line"}`
    });
    push({
      kind: "LineShipping",
      line,
      baseNet: line.shippingCost ?? 0,
      taxPercent: line.taxPercent,
      description: `Shipping — ${line.description ?? line.itemCode ?? "Invoice line"}`
    });
  }
  push({
    kind: "HeaderShipping",
    baseNet: header,
    taxPercent: 0,
    description: "Shipping"
  });

  const totalAmount = toDocumentAmount(source.totalAmount, rate, decimals);
  const totalTax = toDocumentAmount(source.totalTax, rate, decimals);
  // The rounded authoritative gross and native tax define the document net.
  // Any one-unit net difference is allocated to an existing component below.
  const subtotal = round(totalAmount - totalTax, decimals);
  // Rounding each component independently leaves a residual of up to half a
  // minor unit per component. Spread it one unit at a time (largest remainder)
  // rather than concentrating it: a component that absorbs the whole residual
  // stops matching its own taxPercent, and providers that re-derive
  // `tax = net × percent` reject the document outright.
  const reconcileDocument = (
    key: "netAmount" | "taxAmount",
    baseKey: "baseNet" | "baseTax",
    target: number
  ) => {
    // A component with no basis on this axis must stay at zero — a zero-rated
    // line carrying tax is itself a provider refusal. Order by component id so
    // an exact tie resolves the same way whatever order the lines arrived in;
    // the distributor's own tie-break is positional.
    const participants = raw
      .filter((row) => row[baseKey] !== 0)
      .sort((a, b) => a.component.id.localeCompare(b.component.id));
    if (participants.length === 0) {
      if (round(target, decimals) !== 0) {
        throw new Error(
          `Invoice ${key} has no source component for its rounding residual`
        );
      }
      return;
    }
    const allocated = distributeRoundingResidual(
      participants.map((row) =>
        finite(row[baseKey] * rate, `Component document ${key}`)
      ),
      target,
      decimals
    );
    participants.forEach((row, index) => {
      row.component[key] = allocated[index]!;
    });
  };
  reconcileDocument("netAmount", "baseNet", subtotal);
  reconcileDocument("taxAmount", "baseTax", totalTax);
  for (const { component } of raw) {
    // Providers recompute the extended net from quantity × unit price, so the
    // unit price has to reproduce the reconciled net. The stored
    // `convertedUnitPrice` mirror and the converted extension are rounded on two
    // independent float paths and can straddle a half-unit tie, so derive rather
    // than refuse. A unit price is a rate: it keeps storage scale, not
    // settlement decimals.
    if (
      round(component.quantity * component.unitAmount, decimals) !==
      component.netAmount
    ) {
      component.unitAmount = round(
        finite(
          component.netAmount / component.quantity,
          "Reconciled document unit price"
        ),
        SCALE
      );
      // Deriving cannot always converge: past roughly 10^SCALE units, one step
      // of the unit price moves the extension by more than a minor unit, so no
      // representable price reproduces the net. That is a real contradiction
      // between the stored quantity and the document total — refuse it.
      if (
        round(component.quantity * component.unitAmount, decimals) !==
        component.netAmount
      ) {
        throw new Error(
          `Invoice component ${component.id} unit price does not reconcile with its document net`
        );
      }
    }
  }
  return {
    invoiceId: source.id,
    currencyCode: source.currencyCode,
    decimalPlaces: decimals,
    components: raw
      .map((row) => row.component)
      .filter((line) => line.netAmount !== 0 || line.taxAmount !== 0),
    subtotal,
    totalTax,
    totalAmount,
    balance: toDocumentAmount(source.balance, rate, decimals)
  };
}
