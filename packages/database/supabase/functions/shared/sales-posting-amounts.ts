import { credit, debit } from "../lib/utils.ts";
import { toBaseAmount, toDocumentAmount } from "./accounting-currency.ts";
import { assertBalanced, EPSILON, round, SCALE } from "./precision.ts";

export type SalesPostingAmountsInput = {
  quantity: number;
  unitPrice?: number | null;
  shippingCost?: number | null;
  addOnCost?: number | null;
  nonTaxableAddOnCost?: number | null;
  taxPercent?: number | null;
  allocatedHeaderShipping?: number;
};

export type SalesPostingAmounts = {
  salesRevenueBase: number;
  shippingRevenueBase: number;
  salesTaxBase: number;
  grossReceivableBase: number;
};

export type SalesPostingAccount = {
  id: string;
  class: string | null;
  active: boolean;
  isGroup: boolean;
  companyGroupId: string;
};

export type SalesPostingMetadata = {
  customerTypeId: string | null;
  itemPostingGroupId: string | null;
  itemId: string | null;
  locationId: string | null;
  costCenterId: string | null;
  fixedAssetClassId: string | null;
};

export type SalesPostingJournalLine = {
  accountId: string;
  description: string;
  amount: number;
  quantity: number;
  documentType: "Invoice";
  documentId: string;
  externalDocumentId?: string | null;
  documentLineReference?: string | null;
  journalLineReference: string;
  intercompanyPartnerId?: string | null;
  companyId: string;
};

type DisposalAccounts = {
  gainAccount?: SalesPostingAccount | null;
  lossAccount?: SalesPostingAccount | null;
};

export type SalesPostingDisposal =
  & DisposalAccounts
  & ({
    mode: "direct";
    acquisitionCost: number;
    accumulatedDepreciation: number;
    assetAccount?: SalesPostingAccount | null;
    accumulatedDepreciationAccount?: SalesPostingAccount | null;
  } | {
    mode: "shipment";
    netBookValue: number;
    clearingAccount?: SalesPostingAccount | null;
  });

export type BuildSalesPostingLinesInput = {
  line: SalesPostingAmountsInput & { invoiceLineType: string };
  context: {
    companyId: string;
    companyGroupId: string;
    documentId: string;
    externalDocumentId?: string | null;
    documentLineReference?: string | null;
    journalLineReference: string;
    intercompanyPartnerId?: string | null;
  };
  accounts: {
    receivables?: SalesPostingAccount | null;
    sales?: SalesPostingAccount | null;
    shipping?: SalesPostingAccount | null;
    tax?: SalesPostingAccount | null;
  };
  metadata: SalesPostingMetadata;
  disposal?: SalesPostingDisposal;
};

function finite(amount: number, label: string): number {
  if (!Number.isFinite(amount)) throw new Error(`${label} must be finite`);
  return amount;
}

/** Raw arithmetic shared by ledger and provider boundaries; prices are already base. */
export function calculateSalesPostingAmounts(
  input: SalesPostingAmountsInput,
): SalesPostingAmounts {
  const merchandise = finite(input.quantity, "Quantity") *
    finite(input.unitPrice ?? 0, "Unit price");
  const shipping = finite(input.shippingCost ?? 0, "Line shipping");
  const addOn = finite(input.addOnCost ?? 0, "Taxable add-on");
  const nonTaxableAddOn = finite(
    input.nonTaxableAddOnCost ?? 0,
    "Non-taxable add-on",
  );
  const taxPercent = finite(input.taxPercent ?? 0, "Tax rate");
  const salesRevenueBase = finite(
    merchandise + addOn + nonTaxableAddOn,
    "Sales revenue",
  );
  const shippingRevenueBase = finite(
    shipping + finite(input.allocatedHeaderShipping ?? 0, "Header shipping"),
    "Shipping revenue",
  );
  const salesTaxBase = finite(
    (merchandise + shipping + addOn) * taxPercent,
    "Sales tax",
  );
  return {
    salesRevenueBase,
    shippingRevenueBase,
    salesTaxBase,
    grossReceivableBase: finite(
      salesRevenueBase + shippingRevenueBase + salesTaxBase,
      "Gross receivable",
    ),
  };
}

export function allocateSalesHeaderShipping(
  lines: Array<
    SalesPostingAmountsInput & { id: string; invoiceLineType: string }
  >,
  headerShipping: number,
): Map<string, number> {
  const header = toBaseAmount(headerShipping, 1);
  const eligible = lines.filter((line) => line.invoiceLineType !== "Comment")
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (eligible.length === 0 && header !== 0) {
    throw new Error("Header shipping requires a postable invoice line");
  }
  const weights = eligible.map((line) =>
    finite(
      finite(line.quantity, "Quantity") *
          finite(line.unitPrice ?? 0, "Unit price") +
        finite(line.shippingCost ?? 0, "Line shipping") +
        finite(line.addOnCost ?? 0, "Taxable add-on"),
      "Header shipping weight",
    )
  );
  const totalWeight = finite(
    weights.reduce((sum, weight) => sum + weight, 0),
    "Total shipping weight",
  );
  let allocated = 0;
  return new Map(eligible.map((line, index) => {
    const amount = index === eligible.length - 1
      ? round(header - allocated)
      : toBaseAmount(
        header * (totalWeight === 0
          ? 1 / eligible.length
          : weights[index]! / totalWeight),
        1,
      );
    allocated = round(allocated + amount);
    return [line.id, amount];
  }));
}

export function calculateSalesIntercompanyAmount(
  lines: Array<SalesPostingAmountsInput & { invoiceLineType: string }>,
  exchangeRate: number,
): number {
  // Preserve the buyer-compatible matching basis: exclude add-ons, tax and header shipping.
  const base = lines.reduce(
    (sum, line) =>
      line.invoiceLineType === "Comment" ? sum : sum +
        finite(line.quantity, "Quantity") *
          finite(line.unitPrice ?? 0, "Unit price") +
        finite(line.shippingCost ?? 0, "Line shipping"),
    0,
  );
  // The buyer records its half with round() at internal SCALE
  // (post-purchase-invoice), and generate_intercompany_matches pairs the two
  // sides on exact NUMERIC equality with no tolerance. Rounding this half at
  // settlement precision instead would leave every trade whose document amount
  // carries sub-cent digits permanently Unmatched, so eliminations would never
  // run. This is a matching key, not a settlement amount: both halves round at
  // SCALE.
  return toDocumentAmount(base, exchangeRate, SCALE);
}

export function buildSalesPostingLines(input: BuildSalesPostingLinesInput): {
  lines: SalesPostingJournalLine[];
  metadata: SalesPostingMetadata[];
  amounts: SalesPostingAmounts;
  saleProceeds: number;
  netBookValue: number | null;
  gainLoss: number | null;
  signedDebitTotal: number;
} {
  const { line, context, accounts, disposal } = input;
  const empty = {
    salesRevenueBase: 0,
    shippingRevenueBase: 0,
    salesTaxBase: 0,
    grossReceivableBase: 0,
  };
  if (line.invoiceLineType === "Comment") {
    return {
      lines: [],
      metadata: [],
      amounts: empty,
      saleProceeds: 0,
      netBookValue: null,
      gainLoss: null,
      signedDebitTotal: 0,
    };
  }
  if (
    ![
      "Part",
      "Service",
      "Consumable",
      "Fixture",
      "Material",
      "Tool",
      "Fixed Asset",
    ].includes(line.invoiceLineType)
  ) {
    throw new Error(`Unsupported invoice line type: ${line.invoiceLineType}`);
  }
  const isAsset = line.invoiceLineType === "Fixed Asset";
  if (isAsset && !disposal) {
    throw new Error("Fixed asset posting requires disposal facts");
  }
  const raw = calculateSalesPostingAmounts(line);
  const componentKeys = [
    "salesRevenueBase",
    "shippingRevenueBase",
    "salesTaxBase",
  ] as const;
  const amounts: SalesPostingAmounts = {
    salesRevenueBase: toBaseAmount(raw.salesRevenueBase, 1),
    shippingRevenueBase: toBaseAmount(raw.shippingRevenueBase, 1),
    salesTaxBase: toBaseAmount(raw.salesTaxBase, 1),
    grossReceivableBase: toBaseAmount(raw.grossReceivableBase, 1),
  };
  const residual = round(
    amounts.grossReceivableBase -
      componentKeys.reduce((sum, key) => sum + amounts[key], 0),
  );
  // Only reconcile the rounding of these three components and their total.
  // No rounding account or arbitrary balancing entry can hide an economic mismatch.
  const roundingEnvelope = (componentKeys.length + 1) / (2 * 10 ** SCALE) +
    EPSILON;
  if (Math.abs(residual) > roundingEnvelope) {
    throw new Error("Sales component rounding exceeds its precision envelope");
  }
  if (residual !== 0) {
    const recipient = [...componentKeys].sort((a, b) =>
      Math.abs(raw[b]) - Math.abs(raw[a])
    )[0]!;
    amounts[recipient] = round(amounts[recipient] + residual);
  }
  if (
    amounts.shippingRevenueBase !== 0 &&
    accounts.shipping?.id === accounts.sales?.id && accounts.shipping?.id
  ) {
    throw new Error("Shipping revenue and sales accounts must be distinct");
  }

  const lines: SalesPostingJournalLine[] = [];
  const metadata: SalesPostingMetadata[] = [];
  let signedDebitTotal = 0;
  const push = (
    account: SalesPostingAccount | null | undefined,
    accountClass: "Asset" | "Revenue" | "Liability" | "Expense",
    side: "debit" | "credit",
    amount: number,
    description: string,
    isControl = false,
    quantity = line.quantity,
  ) => {
    const baseAmount = toBaseAmount(amount, 1);
    if (baseAmount === 0) return;
    if (
      !account || account.class !== accountClass || !account.active ||
      account.isGroup || account.companyGroupId !== context.companyGroupId
    ) {
      throw new Error(
        `Invalid or missing ${description} account; expected an active ${accountClass} leaf in this company group`,
      );
    }
    const naturalClass = accountClass.toLowerCase() as
      | "asset"
      | "revenue"
      | "liability"
      | "expense";
    lines.push({
      accountId: account.id,
      description,
      amount: side === "debit"
        ? debit(naturalClass, baseAmount)
        : credit(naturalClass, baseAmount),
      quantity: round(quantity),
      documentType: "Invoice",
      documentId: context.documentId,
      externalDocumentId: context.externalDocumentId,
      documentLineReference: context.documentLineReference,
      journalLineReference: context.journalLineReference,
      ...(isControl
        ? { intercompanyPartnerId: context.intercompanyPartnerId }
        : {}),
      companyId: context.companyId,
    });
    metadata.push({ ...input.metadata });
    signedDebitTotal += side === "debit" ? baseAmount : -baseAmount;
  };
  if (!isAsset) {
    push(
      accounts.sales,
      "Revenue",
      "credit",
      amounts.salesRevenueBase,
      "Sales Account",
    );
  }
  push(
    accounts.shipping,
    "Revenue",
    "credit",
    amounts.shippingRevenueBase,
    "Shipping Revenue",
  );
  push(
    accounts.tax,
    "Liability",
    "credit",
    amounts.salesTaxBase,
    "Sales Tax Payable",
  );
  push(
    accounts.receivables,
    "Asset",
    "debit",
    amounts.grossReceivableBase,
    context.intercompanyPartnerId ? "IC Receivables" : "Accounts Receivable",
    true,
  );

  let netBookValue: number | null = null;
  let gainLoss: number | null = null;
  if (isAsset && disposal) {
    if (disposal.mode === "direct") {
      const cost = toBaseAmount(disposal.acquisitionCost, 1);
      const depreciation = toBaseAmount(disposal.accumulatedDepreciation, 1);
      netBookValue = round(cost - depreciation);
      push(
        disposal.accumulatedDepreciationAccount,
        "Asset",
        "debit",
        depreciation,
        "Clear accumulated depreciation",
        false,
        1,
      );
      push(
        disposal.assetAccount,
        "Asset",
        "credit",
        cost,
        "Remove asset at cost",
        false,
        1,
      );
    } else {
      netBookValue = toBaseAmount(disposal.netBookValue, 1);
      push(
        disposal.clearingAccount,
        "Expense",
        "credit",
        netBookValue,
        "Clear disposal clearing",
      );
    }
    gainLoss = round(amounts.salesRevenueBase - netBookValue);
    if (gainLoss > 0) {
      push(
        disposal.gainAccount,
        "Revenue",
        "credit",
        gainLoss,
        "Gain on disposal",
        false,
        disposal.mode === "direct" ? 1 : line.quantity,
      );
    }
    if (gainLoss < 0) {
      push(
        disposal.lossAccount,
        "Expense",
        "debit",
        -gainLoss,
        "Loss on disposal",
        false,
        disposal.mode === "direct" ? 1 : line.quantity,
      );
    }
  }
  signedDebitTotal = round(signedDebitTotal);
  assertBalanced(signedDebitTotal, 0, EPSILON, "Sales invoice charge journal");
  return {
    lines,
    metadata,
    amounts,
    saleProceeds: amounts.salesRevenueBase,
    netBookValue,
    gainLoss,
    signedDebitTotal,
  };
}
