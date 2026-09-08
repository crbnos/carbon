import {
  allocateSalesHeaderShipping,
  calculateSalesPostingAmounts,
  EPSILON,
  round,
  SCALE,
  toBaseAmount,
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
  toBaseAmount(0, rate);
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
  const reconcileDocument = (
    key: "netAmount" | "taxAmount",
    target: number
  ) => {
    const residual = round(
      target - raw.reduce((sum, row) => sum + row.component[key], 0),
      decimals
    );
    if (residual === 0) return;
    const envelope =
      (raw.length + 2) / (2 * 10 ** decimals) + sourceEnvelope * rate;
    if (Math.abs(residual) > envelope) {
      throw new Error(`Invoice ${key} exceeds its document rounding envelope`);
    }
    const baseKey = key === "netAmount" ? "baseNet" : "baseTax";
    const recipient = raw
      .filter((row) => row[baseKey] !== 0)
      .sort(
        (a, b) =>
          Math.abs(b[baseKey]) - Math.abs(a[baseKey]) ||
          a.component.id.localeCompare(b.component.id)
      )[0];
    if (!recipient)
      throw new Error(
        `Invoice ${key} has no source component for its rounding residual`
      );
    recipient.component[key] = round(
      recipient.component[key] + residual,
      decimals
    );
    const component = recipient.component;
    if (
      key === "netAmount" &&
      round(component.unitAmount * component.quantity, decimals) !==
        component.netAmount
    ) {
      // Providers can recompute the extended net from quantity and unit price.
      // Keep the source mirror unless this bounded document residual moved it;
      // a unit price remains a rate, so do not round it to settlement decimals.
      component.unitAmount = finite(
        component.netAmount / component.quantity,
        "Reconciled document unit price"
      );
    }
  };
  reconcileDocument("netAmount", subtotal);
  reconcileDocument("taxAmount", totalTax);
  for (const { component } of raw) {
    if (
      round(component.quantity * component.unitAmount, decimals) !==
      component.netAmount
    ) {
      throw new Error(
        `Invoice component ${component.id} unit price does not reconcile with its document net`
      );
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
