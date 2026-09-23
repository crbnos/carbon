import {
  accountTypeFromClass,
  credit,
  debit,
  journalReference
} from "../../../supabase/functions/lib/utils.ts";
import { buildMemoJournal } from "../../../supabase/functions/post-memo/build-memo-journal.ts";
import { buildPaymentJournal } from "../../../supabase/functions/post-payment/build-payment-journal.ts";
import {
  EPSILON,
  round
} from "../../../supabase/functions/shared/precision.ts";
import {
  buildSalesPostingLines,
  type SalesPostingAccount
} from "../../../supabase/functions/shared/sales-posting-amounts.ts";
import type { AccountClass } from "../types.ts";

/**
 * The journals the posting functions write, built from plain facts so tier 09
 * (facts read back from the seeded rows) and the validator (facts from the
 * dataset literals) derive the SAME lines. Sales invoices, payments and memos
 * go through the edge functions' own pure builders; purchase invoices, receipts,
 * shipments and scrap copy their inline line shapes (post-purchase-invoice's
 * PO-line branch, post-receipt, post-shipment, post-inventory-adjustment). Base currency only, as every seeded
 * posted document is USD at rate 1.
 */

/** An `accountDefault` column, or the memo's own `reasonAccount`. */
export type PostingRole =
  | "receivablesAccount"
  | "payablesAccount"
  | "salesAccount"
  | "bankCashAccount"
  | "goodsReceivedNotInvoicedAccount"
  | "rawMaterialsAccount"
  | "finishedGoodsAccount"
  | "indirectCostAccount"
  | "costOfGoodsSoldAccount"
  | "scrapAccount"
  | "reasonAccount";

export type DefaultPostingRole = Exclude<PostingRole, "reasonAccount">;

/** The class each default must have — the posting functions refuse any other. */
export const POSTING_ROLE_CLASS: Record<DefaultPostingRole, AccountClass> = {
  receivablesAccount: "Asset",
  payablesAccount: "Liability",
  salesAccount: "Revenue",
  bankCashAccount: "Asset",
  goodsReceivedNotInvoicedAccount: "Liability",
  rawMaterialsAccount: "Asset",
  finishedGoodsAccount: "Asset",
  indirectCostAccount: "Expense",
  costOfGoodsSoldAccount: "Expense",
  scrapAccount: "Expense"
};

export type PostingSourceType =
  | "Sales Invoice"
  | "Purchase Invoice"
  | "Payment"
  | "Credit Memo"
  | "Debit Memo"
  | "Purchase Receipt"
  | "Sales Shipment"
  | "Inventory Adjustment";

export type PostingLine = {
  role: PostingRole;
  accountClass: AccountClass;
  description: string;
  /** Signed by the account's natural balance (lib/utils.ts debit/credit). */
  amount: number;
  quantity: number;
  documentType:
    | "Invoice"
    | "Payment"
    | "Memo"
    | "Receipt"
    | "Sales Shipment"
    | "Scrap";
  documentLineReference?: string | null;
  accrual?: boolean;
  /** Lines of one group share a journalLineReference (the functions' nanoid()). */
  group: number;
};

export type PostingJournal = {
  sourceType: PostingSourceType;
  description: string;
  lines: PostingLine[];
};

/**
 * Debits minus credits under the posting functions' sign convention (a positive
 * amount debits an Asset/Expense account and credits the others); 0 when
 * balanced.
 */
export function signedNet(
  lines: readonly { accountClass: AccountClass; amount: number }[]
): number {
  return round(
    lines.reduce(
      (net, line) =>
        net + debit(accountTypeFromClass(line.accountClass), line.amount),
      0
    )
  );
}

export function postingImbalance(journal: PostingJournal): number {
  return signedNet(journal.lines);
}

export function isBalanced(journal: PostingJournal): boolean {
  return Math.abs(postingImbalance(journal)) <= EPSILON;
}

function roleLine(
  role: DefaultPostingRole,
  line: Omit<PostingLine, "role" | "accountClass">
): PostingLine {
  return { role, accountClass: POSTING_ROLE_CLASS[role], ...line };
}

/** resolveInventoryAccount (get-posting-group.ts) plus post-receipt's Non-Inventory branch. */
export function inventoryRoleFor(item: {
  replenishmentSystem: string | null;
  itemTrackingType: string | null;
}): {
  role: DefaultPostingRole;
  description: string;
} {
  if (item.itemTrackingType === "Non-Inventory") {
    return {
      role: "indirectCostAccount",
      description: "Indirect Cost Account"
    };
  }
  return item.replenishmentSystem === "Make" ||
    item.replenishmentSystem === "Buy and Make"
    ? { role: "finishedGoodsAccount", description: "Finished Goods Account" }
    : { role: "rawMaterialsAccount", description: "Raw Materials Account" };
}

const pseudoAccount = (role: DefaultPostingRole): SalesPostingAccount => ({
  id: role,
  class: POSTING_ROLE_CLASS[role],
  active: true,
  isGroup: false,
  companyGroupId: "group"
});

/** post-sales-invoice, sales-order lines: the charge rows only (COGS rides on the shipment). */
export function salesInvoiceJournal(args: {
  invoiceReadableId: string;
  documentId: string;
  lines: { quantity: number; unitPrice: number; salesOrderLineId: string }[];
}): PostingJournal {
  const lines: PostingLine[] = [];
  args.lines.forEach((line, group) => {
    const built = buildSalesPostingLines({
      line: {
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        invoiceLineType: "Part"
      },
      context: {
        companyId: "",
        companyGroupId: "group",
        documentId: args.documentId,
        documentLineReference: journalReference.to.salesInvoice(
          line.salesOrderLineId
        ),
        journalLineReference: ""
      },
      accounts: {
        receivables: pseudoAccount("receivablesAccount"),
        sales: pseudoAccount("salesAccount")
      },
      metadata: {
        customerTypeId: null,
        itemPostingGroupId: null,
        itemId: null,
        locationId: null,
        costCenterId: null,
        fixedAssetClassId: null
      }
    });
    for (const builtLine of built.lines) {
      const role = builtLine.accountId as DefaultPostingRole;
      lines.push(
        roleLine(role, {
          description: builtLine.description,
          amount: builtLine.amount,
          quantity: builtLine.quantity,
          documentType: "Invoice",
          documentLineReference: builtLine.documentLineReference,
          group
        })
      );
    }
  });
  return {
    sourceType: "Sales Invoice",
    description: `Sales Invoice ${args.invoiceReadableId}`,
    lines
  };
}

/**
 * post-purchase-invoice, purchase-order lines: the received share clears GR/IR
 * at receipt cost, the rest accrues (GR/IR debit + AP, `accrual`). Seeded
 * invoices bill at the receipt price, so there is no price variance to split.
 */
export function purchaseInvoiceJournal(args: {
  invoiceReadableId: string;
  lines: {
    quantity: number;
    unitCost: number;
    purchaseOrderLineId: string;
    /** Posted receipts of this PO line on or before the invoice's posting date. */
    receivedQuantity: number;
    receiptUnitCost: number | null;
  }[];
}): PostingJournal {
  const lines: PostingLine[] = [];
  let group = 0;
  for (const line of args.lines) {
    const reference = journalReference.to.purchaseInvoice(
      line.purchaseOrderLineId
    );
    const reversed = Math.max(
      0,
      Math.min(line.quantity, line.receivedQuantity)
    );
    if (reversed > 0) {
      const receiptCost = reversed * (line.receiptUnitCost ?? line.unitCost);
      if (Math.abs(receiptCost - reversed * line.unitCost) > 0.005) {
        throw new Error(
          `Seed: purchase invoice ${args.invoiceReadableId} bills a received line away from its receipt price`
        );
      }
      lines.push(
        roleLine("goodsReceivedNotInvoicedAccount", {
          description: "GR/IR Clearing",
          amount: round(debit("liability", receiptCost)),
          quantity: round(reversed),
          documentType: "Invoice",
          documentLineReference: reference,
          group
        }),
        roleLine("payablesAccount", {
          description: "Accounts Payable",
          amount: round(credit("liability", receiptCost)),
          quantity: round(reversed),
          documentType: "Invoice",
          documentLineReference: reference,
          group
        })
      );
      group++;
    }
    const accrued = line.quantity - reversed;
    if (accrued > 0) {
      const accrualCost = accrued * line.unitCost;
      lines.push(
        roleLine("goodsReceivedNotInvoicedAccount", {
          description: "GR/IR Clearing",
          accrual: true,
          amount: round(debit("liability", accrualCost)),
          quantity: round(accrued),
          documentType: "Invoice",
          documentLineReference: reference,
          group
        }),
        roleLine("payablesAccount", {
          description: "Accounts Payable",
          accrual: true,
          amount: round(credit("liability", accrualCost)),
          quantity: round(accrued),
          documentType: "Invoice",
          documentLineReference: reference,
          group
        })
      );
      group++;
    }
  }
  return {
    sourceType: "Purchase Invoice",
    description: `Purchase Invoice ${args.invoiceReadableId}`,
    lines
  };
}

/** The void branch of post-{sales,purchase}-invoice: every line negated, same references. */
export function voidJournal(
  journal: PostingJournal,
  invoiceReadableId: string
): PostingJournal {
  return {
    sourceType: journal.sourceType,
    description: `VOID ${journal.sourceType} ${invoiceReadableId}`,
    lines: journal.lines.map((line) => ({
      ...line,
      description: `VOID: ${line.description}`,
      amount: -line.amount,
      quantity: -line.quantity
    }))
  };
}

/** post-payment's buildPaymentJournal: cash against the control account, one reference. */
export function paymentJournal(args: {
  paymentReadableId: string;
  documentId: string;
  type: "Receipt" | "Disbursement";
  amount: number;
  applies: { targetId: string; amount: number }[];
}): PostingJournal {
  const isAR = args.type === "Receipt";
  const control: DefaultPostingRole = isAR
    ? "receivablesAccount"
    : "payablesAccount";
  const applied = args.applies.reduce((sum, a) => sum + a.amount, 0);
  const built = buildPaymentJournal({
    paymentId: args.documentId,
    companyId: "",
    isAR,
    cashIn: isAR,
    totalAmount: args.amount,
    exchangeRate: 1,
    bankAccount: "bankCashAccount",
    journalLineReference: "",
    applications: args.applies.map((apply) => ({
      targetSalesInvoiceId: isAR ? apply.targetId : null,
      targetPurchaseInvoiceId: isAR ? null : apply.targetId,
      sourceAmount: apply.amount,
      sourcePaymentId: null,
      fxGainLossAmount: 0,
      appliedAmount: apply.amount,
      discountAmount: 0,
      writeOffAmount: 0,
      targetExchangeRate: 1,
      sourceExchangeRate: 1
    })),
    newOnAccountBase: round(args.amount - applied),
    accounts: {
      controlAccountId: control,
      discountAccountId: null,
      writeOffAccountId: null,
      fxGainAccountId: null,
      fxLossAccountId: null
    }
  });
  return {
    sourceType: "Payment",
    description: `Payment ${args.paymentReadableId}`,
    lines: built.lines.map((line) =>
      roleLine(line.accountId as DefaultPostingRole, {
        description: line.description,
        amount: line.amount,
        quantity: line.quantity,
        documentType: "Payment",
        documentLineReference: line.documentLineReference,
        group: 0
      })
    )
  };
}

/** post-memo's buildMemoJournal, two-line shape (no return-shipment carried cost). */
export function memoJournal(args: {
  memoReadableId: string;
  documentId: string;
  direction: "Credit" | "Debit";
  isAR: boolean;
  amount: number;
  reasonAccountClass: AccountClass;
}): PostingJournal {
  const control: DefaultPostingRole = args.isAR
    ? "receivablesAccount"
    : "payablesAccount";
  const built = buildMemoJournal({
    memoId: args.documentId,
    companyId: "",
    isAR: args.isAR,
    direction: args.direction,
    amount: args.amount,
    exchangeRate: 1,
    journalLineReference: "",
    controlAccountId: control,
    reasonAccountId: "reasonAccount",
    reasonAccountClass: args.reasonAccountClass
  });
  return {
    sourceType: args.direction === "Credit" ? "Credit Memo" : "Debit Memo",
    description: `${args.direction} Memo ${args.memoReadableId}`,
    lines: built.lines.map((line) =>
      line.accountId === "reasonAccount"
        ? {
            role: "reasonAccount",
            accountClass: args.reasonAccountClass,
            description: line.description,
            amount: line.amount,
            quantity: line.quantity,
            documentType: "Memo",
            group: 0
          }
        : roleLine(control, {
            description: line.description,
            amount: line.amount,
            quantity: line.quantity,
            documentType: "Memo",
            group: 0
          })
    )
  };
}

/** post-receipt, purchase-order branch: DR inventory (or indirect cost) / CR GR/IR at receipt cost. */
export function receiptJournal(args: {
  receiptReadableId: string;
  lines: {
    quantity: number;
    cost: number;
    purchaseOrderLineId: string;
    replenishmentSystem: string | null;
    itemTrackingType: string | null;
  }[];
}): PostingJournal {
  const lines: PostingLine[] = [];
  args.lines.forEach((line, group) => {
    const inventory = inventoryRoleFor(line);
    const reference = journalReference.to.receipt(line.purchaseOrderLineId);
    lines.push(
      roleLine(inventory.role, {
        description: inventory.description,
        amount: round(debit("asset", line.cost)),
        quantity: round(line.quantity),
        documentType: "Receipt",
        documentLineReference: reference,
        group
      }),
      roleLine("goodsReceivedNotInvoicedAccount", {
        description: "Goods Received Not Invoiced",
        amount: round(credit("liability", line.cost)),
        quantity: round(line.quantity),
        documentType: "Receipt",
        documentLineReference: reference,
        group
      })
    );
  });
  return {
    sourceType: "Purchase Receipt",
    description: `Purchase Receipt ${args.receiptReadableId}`,
    lines
  };
}

/** post-shipment, sales-order branch: DR COGS / CR inventory at the consumed cost. */
export function shipmentJournal(args: {
  shipmentReadableId: string;
  lines: {
    quantity: number;
    cost: number;
    shipmentLineId: string;
    replenishmentSystem: string | null;
    itemTrackingType: string | null;
  }[];
}): PostingJournal {
  const lines: PostingLine[] = [];
  args.lines.forEach((line, group) => {
    const inventory = inventoryRoleFor(line);
    const reference = journalReference.to.shipment(line.shipmentLineId);
    lines.push(
      roleLine("costOfGoodsSoldAccount", {
        description: "Cost of Goods Sold",
        amount: round(debit("expense", line.cost)),
        quantity: round(line.quantity),
        documentType: "Sales Shipment",
        documentLineReference: reference,
        group
      }),
      roleLine(inventory.role, {
        description: inventory.description,
        amount: round(credit("asset", line.cost)),
        quantity: round(line.quantity),
        documentType: "Sales Shipment",
        documentLineReference: reference,
        group
      })
    );
  });
  return {
    sourceType: "Sales Shipment",
    description: `Sales Shipment ${args.shipmentReadableId}`,
    lines
  };
}

/** post-inventory-adjustment's Scrap (bookAdjustment): CR inventory / DR the scrap account at the relieved cost. */
export function scrapJournal(args: {
  description: string;
  quantity: number;
  cost: number;
  replenishmentSystem: string | null;
  itemTrackingType: string | null;
}): PostingJournal {
  const inventory = inventoryRoleFor(args);
  return {
    sourceType: "Inventory Adjustment",
    description: args.description,
    lines: [
      roleLine(inventory.role, {
        description: inventory.description,
        amount: round(credit("asset", args.cost)),
        quantity: round(args.quantity),
        documentType: "Scrap",
        group: 0
      }),
      roleLine("scrapAccount", {
        description: "Scrap Account",
        amount: round(debit("expense", args.cost)),
        quantity: round(args.quantity),
        documentType: "Scrap",
        group: 0
      })
    ]
  };
}

/**
 * calculateCOGS for a FIFO item: draw the oldest layers with stock, then the
 * item's unitCost for whatever the layers do not cover. Mutates `remaining`.
 */
export function consumeFifo(
  layers: { quantity: number; cost: number; remaining: number }[],
  quantity: number,
  fallbackUnitCost: number
): number {
  let toConsume = quantity;
  let total = 0;
  for (const layer of layers) {
    if (toConsume <= 0) break;
    if (layer.remaining <= 0) continue;
    const unitCost = layer.quantity > 0 ? layer.cost / layer.quantity : 0;
    const take = Math.min(toConsume, layer.remaining);
    total += take * unitCost;
    layer.remaining -= take;
    toConsume -= take;
  }
  if (toConsume > 0) total += toConsume * fallbackUnitCost;
  return total;
}
