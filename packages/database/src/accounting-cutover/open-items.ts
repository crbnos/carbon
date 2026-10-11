// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The document-level items open at the cutover
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 4):
// receivables, payables, employee reimbursements, unapplied credit, deposits,
// received-not-invoiced, invoiced-not-received, work in progress, deferred revenue and lease net
// investment.

import { sql } from "kysely";
import { toBaseAmount } from "../accounting-currency";
import {
  dayBeforeCutover,
  type JournalLineDocumentType,
  type OpenItem,
  type OpenItemType
} from "../accounting-cutover";
import {
  CUSTOMER_DEPOSIT_DESCRIPTION,
  DOCUMENT_JOURNAL_STATUSES,
  onAccountCreditDescription,
  REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION
} from "../accounting-posting";
import { configuredDefaultAccount } from "../journal-posting-status";
import { credit, debit, debitSigned } from "../ledger";
import { EPSILON, round } from "../precision";
import { journalReference } from "../utils";
import {
  type AccountDefaults,
  addTo,
  type CutoverArgs,
  type CutoverContext,
  type CutoverDb,
  getAccounts,
  loadCutoverContext,
  requireClass
} from "./shared";

/** The descriptions a receipt and a purchase invoice write on GR/IR. */
const GOODS_RECEIVED_NOT_INVOICED_DESCRIPTION = "Goods Received Not Invoiced";
const GR_IR_CLEARING_DESCRIPTION = "GR/IR Clearing";

/**
 * An open item before its account class is known. `basis` says how its
 * amounts are signed: "debit" (positive = debit) or "natural" (already
 * natural-balance-signed for its account, as a journal line).
 */
export type DraftItem = {
  openItemType: OpenItemType;
  accountId: string;
  basis: "debit" | "natural";
  original: number;
  settled: number;
  documentType: JournalLineDocumentType | null;
  documentId: string | null;
  documentLineReference: string | null;
  description: string;
  /** The original line's quantity. */
  quantity?: number | null;
  /** The original line is an accrual. Kept at a zero amount: a receipt
   *  after the cutover still claims a zero-priced accrual. */
  accrual?: boolean;
  /** How the part settled before the cutover is keyed, when not the default. */
  settledLine?: OpenItem["settled"];
};

type OpenDocumentRow = {
  partyId: string | null;
  documentId: string;
  documentNumber: string;
  documentType: string;
  totalAmount: number;
  exchangeRate: number;
  openInBase: number;
};

type SettlementRow = {
  paymentId: string | null;
  memoId: string | null;
  sourcePaymentId: string | null;
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  targetMemoId: string | null;
  targetReimbursementId: string | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number;
};

/**
 * Settlements in effect on the day before the cutover, by the rule
 * `get_ar_open_by_customer` and `get_ap_open_by_supplier` use: a payment's
 * settlements once the payment is Posted on or before that day; a memo's
 * once the memo is, and, when it was applied through a payment, that payment
 * too.
 */
async function getSettlementsBeforeCutover(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string
): Promise<SettlementRow[]> {
  const rows = await db
    .selectFrom("invoiceSettlement as s")
    .leftJoin("payment as p", (join) =>
      join
        .onRef("p.id", "=", "s.paymentId")
        .onRef("p.companyId", "=", "s.companyId")
    )
    .leftJoin("memo as m", (join) =>
      join
        .onRef("m.id", "=", "s.memoId")
        .onRef("m.companyId", "=", "s.companyId")
    )
    .leftJoin("payment as vp", (join) =>
      join
        .onRef("vp.id", "=", "s.appliedViaPaymentId")
        .onRef("vp.companyId", "=", "s.companyId")
    )
    .select([
      "s.paymentId",
      "s.memoId",
      "s.sourcePaymentId",
      "s.targetSalesInvoiceId",
      "s.targetPurchaseInvoiceId",
      "s.targetMemoId",
      "s.targetReimbursementId",
      "s.appliedAmount",
      "s.discountAmount",
      "s.writeOffAmount",
      "s.fxGainLossAmount"
    ])
    .where("s.companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb.and([
          eb("s.paymentId", "is not", null),
          eb("p.status", "=", "Posted"),
          eb("p.postingDate", "<", cutoverDate)
        ]),
        eb.and([
          eb("s.memoId", "is not", null),
          eb("m.status", "=", "Posted"),
          eb("m.postingDate", "<", cutoverDate),
          eb.or([
            eb.and([
              eb("s.appliedViaPaymentId", "is", null),
              eb("s.appliedDate", "<", cutoverDate)
            ]),
            eb.and([
              eb("vp.status", "=", "Posted"),
              eb("vp.postingDate", "<", cutoverDate)
            ])
          ])
        ])
      ])
    )
    .execute();
  return rows.map((row) => ({
    ...row,
    appliedAmount: Number(row.appliedAmount ?? 0),
    discountAmount: Number(row.discountAmount ?? 0),
    writeOffAmount: Number(row.writeOffAmount ?? 0),
    fxGainLossAmount: Number(row.fxGainLossAmount ?? 0)
  }));
}

/**
 * Receivables and payables open at the cutover: one item per invoice and
 * memo `get_ar_open_by_customer` / `get_ap_open_by_supplier` report open on
 * the day before the cutover. `originalAmount` is the document's base
 * control amount as those readers compute it when no Posted control line
 * exists (an invoice's base total; a memo's amount at its rate), and
 * `settledBeforeCutover` is what settlements in effect by then applied. The
 * split must agree with the readers' open amount, or the read refuses.
 */
async function getReceivableAndPayableItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults,
  settlements: SettlementRow[]
): Promise<DraftItem[]> {
  const asOf = dayBeforeCutover(cutoverDate);
  const [receivables, payables] = await Promise.all([
    sql<OpenDocumentRow>`
      SELECT "customerId" AS "partyId", "documentId", "documentNumber",
        "documentType", "totalAmount", "exchangeRate", "openInBase"
      FROM get_ar_open_by_customer(${companyId}, ${asOf}::date)
    `.execute(db),
    sql<OpenDocumentRow>`
      SELECT "supplierId" AS "partyId", "documentId", "documentNumber",
        "documentType", "totalAmount", "exchangeRate", "openInBase"
      FROM get_ap_open_by_supplier(${companyId}, ${asOf}::date)
    `.execute(db)
  ]);

  const customerIds = receivables.rows
    .map((row) => row.partyId)
    .filter((id): id is string => Boolean(id));
  const supplierIds = payables.rows
    .map((row) => row.partyId)
    .filter((id): id is string => Boolean(id));
  const [customers, suppliers] = await Promise.all([
    customerIds.length
      ? db
          .selectFrom("customer")
          .select(["id", "intercompanyCompanyId"])
          .where("companyId", "=", companyId)
          .where("id", "in", [...new Set(customerIds)])
          .execute()
      : Promise.resolve([]),
    supplierIds.length
      ? db
          .selectFrom("supplier")
          .select(["id", "intercompanyCompanyId"])
          .where("companyId", "=", companyId)
          .where("id", "in", [...new Set(supplierIds)])
          .execute()
      : Promise.resolve([])
  ]);
  const intercompanyCustomers = new Set(
    customers.filter((row) => row.intercompanyCompanyId).map((row) => row.id)
  );
  const intercompanySuppliers = new Set(
    suppliers.filter((row) => row.intercompanyCompanyId).map((row) => row.id)
  );

  // Base settled before the cutover, per the readers' own sums.
  const invoiceSettled = new Map<string, number>();
  const arMemoSettled = new Map<string, number>();
  const apMemoSettled = new Map<string, number>();
  for (const row of settlements) {
    const adjusted =
      row.appliedAmount + row.discountAmount + row.writeOffAmount;
    addTo(invoiceSettled, row.targetSalesInvoiceId, adjusted);
    addTo(invoiceSettled, row.targetPurchaseInvoiceId, adjusted);
    // A memo applied as a credit: AR adds the realized FX, AP subtracts it.
    addTo(arMemoSettled, row.memoId, row.appliedAmount + row.fxGainLossAmount);
    addTo(apMemoSettled, row.memoId, row.appliedAmount - row.fxGainLossAmount);
    // A memo refunded by a payment.
    if (row.paymentId) {
      addTo(arMemoSettled, row.targetMemoId, row.appliedAmount);
      addTo(apMemoSettled, row.targetMemoId, row.appliedAmount);
    }
  }

  const items: DraftItem[] = [];
  const mismatches: string[] = [];
  const build = (row: OpenDocumentRow, isAR: boolean) => {
    const isInvoice = row.documentType === "Invoice";
    const isIntercompany = row.partyId
      ? (isAR ? intercompanyCustomers : intercompanySuppliers).has(row.partyId)
      : false;
    // Signed as the reader signs `openInBase`: positive is the control
    // account's natural side (a debit on receivables, a credit on payables).
    const sign = isInvoice
      ? 1
      : isAR
        ? row.documentType === "Credit Memo"
          ? -1
          : 1
        : row.documentType === "Debit Memo"
          ? -1
          : 1;
    const originalBase = isInvoice
      ? round(Number(row.totalAmount))
      : round(Number(row.totalAmount) / Number(row.exchangeRate));
    const settledBase = isInvoice
      ? (invoiceSettled.get(row.documentId) ?? 0)
      : ((isAR ? arMemoSettled : apMemoSettled).get(row.documentId) ?? 0);
    const original = sign * originalBase;
    const settled = round(sign * settledBase);
    if (Math.abs(original - settled - Number(row.openInBase)) > EPSILON) {
      mismatches.push(row.documentNumber);
    }

    const accountId = isAR
      ? isInvoice && isIntercompany
        ? (defaults.intercompanyReceivablesAccount ??
          defaults.receivablesAccount)
        : defaults.receivablesAccount
      : isInvoice && isIntercompany
        ? (defaults.intercompanyPayablesAccount ?? defaults.payablesAccount)
        : defaults.payablesAccount;
    // The description the document's own posting writes on its control
    // line. Sales invoices write "IC Receivables" for an intercompany
    // customer; purchase invoices and memos always write the plain one.
    const description = isAR
      ? isInvoice && isIntercompany
        ? "IC Receivables"
        : "Accounts Receivable"
      : "Accounts Payable";
    // A natural-signed amount on the control account's own side: receivables
    // are debit-natured, payables credit-natured.
    items.push({
      openItemType: isAR ? "Receivable" : "Payable",
      accountId,
      basis: "debit",
      original: isAR ? original : -original,
      settled: isAR ? settled : -settled,
      documentType: isInvoice ? "Invoice" : "Memo",
      documentId: row.documentId,
      documentLineReference: null,
      description
    });
  };
  for (const row of receivables.rows) build(row, true);
  for (const row of payables.rows) build(row, false);

  if (mismatches.length > 0) {
    throw new Error(
      `The open amount of ${mismatches.join(", ")} does not match the receivables and payables reports`
    );
  }
  return items;
}

/**
 * Employee reimbursements open at the cutover: one item per reimbursement
 * Posted before the cutover (its posting date, else its reimbursement date)
 * and not fully paid out the day before it. A Voided one is not open, as the
 * AR/AP readers skip a Voided invoice.
 *
 * `originalAmount` is the amount in base at the reimbursement's rate, the
 * total `post-payment` falls back to when a reimbursement has no control
 * line. `settledBeforeCutover` is what payouts Posted before the cutover
 * applied (`invoiceSettlement.targetReimbursementId`), as a payout debits the
 * payable: applied plus discount plus write-off. The item is on the account
 * the posting credited (`payableAccountId`), which the payout checks against
 * the control line; a row with none takes the employee reimbursements payable
 * default, else payables (`DEFAULT_FALLBACKS`). The description is the one the
 * payout's control lookup matches.
 */
async function getReimbursementItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults,
  settlements: SettlementRow[]
): Promise<DraftItem[]> {
  const rows = await db
    .selectFrom("reimbursement")
    .select(["id", "amount", "exchangeRate", "payableAccountId"])
    .where("companyId", "=", companyId)
    .where("status", "=", "Posted")
    .where((eb) =>
      eb(eb.fn.coalesce("postingDate", "reimbursementDate"), "<", cutoverDate)
    )
    .execute();
  if (rows.length === 0) return [];

  const settled = new Map<string, number>();
  for (const row of settlements) {
    addTo(
      settled,
      row.targetReimbursementId,
      row.appliedAmount + row.discountAmount + row.writeOffAmount
    );
  }

  const fallbackAccountId = configuredDefaultAccount(
    defaults,
    "employeeReimbursementsPayableAccount"
  );
  const items: DraftItem[] = [];
  for (const row of rows) {
    const original = toBaseAmount(Number(row.amount), Number(row.exchangeRate));
    const settledBase = round(settled.get(row.id) ?? 0);
    if (original - settledBase <= EPSILON) continue;
    const accountId = row.payableAccountId ?? fallbackAccountId;
    if (!accountId) {
      throw new Error(
        "Set the employeeReimbursementsPayableAccount account default"
      );
    }
    // A credit balance: the payable is credited at posting and debited by
    // each payout.
    items.push({
      openItemType: "Reimbursement",
      accountId,
      basis: "debit",
      original: -original,
      settled: -settledBase,
      documentType: "Reimbursement",
      documentId: row.id,
      documentLineReference: null,
      description: REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION
    });
  }
  return items;
}

/**
 * Unapplied credit and customer deposits: per payment posted before the
 * cutover, the unapplied cash it booked, less what later payments before the
 * cutover drew from it.
 *
 * A payment with a journal takes the unapplied line that journal wrote. A
 * legacy payment (no journal: it posted with accounting off, or the reset
 * deleted its journal) takes the same number from the payment and its
 * settlements, as `buildPaymentJournal` books it: the cash in base less what
 * the payment's own applications released, on the control account (or, for
 * a customer deposit, the prepayment account), under the description its
 * posting writes.
 */
async function getUnappliedPaymentItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults,
  settlements: SettlementRow[]
): Promise<DraftItem[]> {
  const [lines, legacyPayments] = await Promise.all([
    db
      .selectFrom("payment")
      .innerJoin("journalLine as line", (join) =>
        join
          .onRef("line.journalId", "=", "payment.journalId")
          .onRef("line.companyId", "=", "payment.companyId")
          .onRef("line.documentId", "=", "payment.id")
      )
      .select([
        "payment.id",
        "payment.customerId",
        "line.accountId",
        "line.accountDefaultRole",
        "line.amount",
        "line.description"
      ])
      .where("payment.companyId", "=", companyId)
      .where("payment.status", "=", "Posted")
      .where("payment.postingDate", "<", cutoverDate)
      .where("line.documentType", "=", "Payment")
      .where("line.description", "in", [
        onAccountCreditDescription(true),
        onAccountCreditDescription(false),
        CUSTOMER_DEPOSIT_DESCRIPTION
      ])
      .execute(),
    db
      .selectFrom("payment")
      .leftJoin("customer", (join) =>
        join
          .onRef("customer.id", "=", "payment.customerId")
          .onRef("customer.companyId", "=", "payment.companyId")
      )
      .leftJoin("supplier", (join) =>
        join
          .onRef("supplier.id", "=", "payment.supplierId")
          .onRef("supplier.companyId", "=", "payment.companyId")
      )
      .select([
        "payment.id",
        "payment.customerId",
        "payment.paymentType",
        "payment.totalAmount",
        "payment.exchangeRate",
        "payment.salesOrderId",
        "payment.rentalAgreementId",
        "customer.intercompanyCompanyId as customerIntercompanyId",
        "supplier.intercompanyCompanyId as supplierIntercompanyId"
      ])
      .where("payment.companyId", "=", companyId)
      .where("payment.status", "=", "Posted")
      .where("payment.postingDate", "<", cutoverDate)
      // A customer or supplier payment; an employee payout holds no credit.
      .where((eb) =>
        eb.or([
          eb("payment.customerId", "is not", null),
          eb("payment.supplierId", "is not", null)
        ])
      )
      // Legacy: no journal line of any status names the payment.
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("journalLine as line")
              .select("line.id")
              .whereRef("line.documentId", "=", "payment.id")
              .whereRef("line.companyId", "=", "payment.companyId")
              .where("line.documentType", "=", "Payment")
          )
        )
      )
      .execute()
  ]);

  // Base each source payment's credit released before the cutover, as
  // `remainingFundingSources` reduces a funding source.
  const consumed = new Map<string, { ar: number; ap: number }>();
  // Base the payment's own applications released from its cash, as
  // `buildPaymentJournal` sums them (FX added when cash comes in).
  const ownReleased = new Map<string, { cashIn: number; cashOut: number }>();
  for (const row of settlements) {
    if (row.sourcePaymentId) {
      const current = consumed.get(row.sourcePaymentId) ?? { ar: 0, ap: 0 };
      current.ar += row.appliedAmount + row.fxGainLossAmount;
      current.ap += row.appliedAmount - row.fxGainLossAmount;
      consumed.set(row.sourcePaymentId, current);
    } else if (row.paymentId) {
      const current = ownReleased.get(row.paymentId) ?? {
        cashIn: 0,
        cashOut: 0
      };
      current.cashIn += row.appliedAmount + row.fxGainLossAmount;
      current.cashOut += row.appliedAmount - row.fxGainLossAmount;
      ownReleased.set(row.paymentId, current);
    }
  }
  const releasedFrom = (paymentId: string, isAR: boolean, original: number) => {
    const use = consumed.get(paymentId);
    const released = use ? (isAR ? use.ar : use.ap) : 0;
    return round(Math.sign(original) * released);
  };

  const journaled = lines.map((line): DraftItem => {
    const isAR = line.customerId != null;
    const original = Number(line.amount);
    const isDeposit = line.description === CUSTOMER_DEPOSIT_DESCRIPTION;
    return {
      openItemType: isDeposit ? "Customer Deposit" : "Unapplied Credit",
      accountId: resolveLineAccount(line, defaults),
      basis: "natural",
      original,
      settled: releasedFrom(line.id, isAR, original),
      documentType: "Payment",
      documentId: line.id,
      documentLineReference: null,
      description: line.description ?? ""
    };
  });

  const legacy: DraftItem[] = [];
  for (const payment of legacyPayments) {
    const isAR = payment.customerId != null;
    const cashIn = payment.paymentType === "Receipt";
    const isDeposit =
      isAR && Boolean(payment.rentalAgreementId ?? payment.salesOrderId);
    const own = ownReleased.get(payment.id);
    const unapplied = round(
      toBaseAmount(Number(payment.totalAmount), Number(payment.exchangeRate)) -
        (own ? (cashIn ? own.cashIn : own.cashOut) : 0)
    );
    if (unapplied <= EPSILON) continue;
    const isIntercompany = Boolean(
      isAR ? payment.customerIntercompanyId : payment.supplierIntercompanyId
    );
    const accountId = isDeposit
      ? defaults.prepaymentAccount
      : isAR
        ? isIntercompany
          ? (defaults.intercompanyReceivablesAccount ??
            defaults.receivablesAccount)
          : defaults.receivablesAccount
        : isIntercompany
          ? (defaults.intercompanyPayablesAccount ?? defaults.payablesAccount)
          : defaults.payablesAccount;
    // The unapplied leg `buildPaymentJournal` books: a credit when cash came
    // in, a debit when it went out; a deposit is a liability.
    const accountType = isDeposit ? "liability" : isAR ? "asset" : "liability";
    const original = cashIn
      ? credit(accountType, unapplied)
      : debit(accountType, unapplied);
    legacy.push({
      openItemType: isDeposit ? "Customer Deposit" : "Unapplied Credit",
      accountId,
      basis: "natural",
      original,
      settled: releasedFrom(payment.id, isAR, original),
      documentType: "Payment",
      documentId: payment.id,
      documentLineReference: null,
      description: isDeposit
        ? CUSTOMER_DEPOSIT_DESCRIPTION
        : onAccountCreditDescription(isAR)
    });
  }

  return [...journaled, ...legacy];
}

/**
 * The account a journal line belongs on. A stand-in line, written before the
 * cutover while its default was empty, names the default it wanted.
 */
function resolveLineAccount(
  line: { accountId: string | null; accountDefaultRole: string | null },
  defaults: AccountDefaults
): string {
  if (line.accountDefaultRole) {
    const accountId =
      defaults[line.accountDefaultRole as keyof AccountDefaults];
    if (typeof accountId !== "string" || !accountId) {
      throw new Error(`Set the ${line.accountDefaultRole} account default`);
    }
    return accountId;
  }
  if (!line.accountId) throw new Error("A journal line has no account");
  return line.accountId;
}

/**
 * Received, not invoiced: per purchase order line with more received than
 * invoiced before the cutover, what the purchase invoice's GR/IR walk needs
 * to find. That walk reads the line's `receipt:<poLineId>` journal groups in
 * order, skips the units already invoiced and costs the rest from each
 * group's amount and quantity. So the item carries:
 * - everything received before the cutover, with its quantity (inventory
 *   unit) and receipt cost, on `receipt:<poLineId>`;
 * - what the invoices before the cutover cleared, with the opposite sign, on
 *   `purchase-invoice:<poLineId>`, which the walk does not read.
 * A receipt's cost is its GR/IR journal line; a receipt with none (posted
 * before Carbon wrote journals for every company) takes its cost layers, else
 * quantity × unit price. An invoice's clearing is its GR/IR Clearing lines; an
 * invoice with no journal at all clears its quantity at the line's average
 * receipt cost.
 */
async function getReceivedNotInvoicedItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const grIrAccountId = defaults.goodsReceivedNotInvoicedAccount;
  const receiptLines = await db
    .selectFrom("receiptLine as line")
    .innerJoin("receipt", (join) =>
      join
        .onRef("receipt.id", "=", "line.receiptId")
        .onRef("receipt.companyId", "=", "line.companyId")
    )
    .select([
      "line.receiptId",
      "line.lineId",
      "line.itemId",
      "line.receivedQuantity",
      "line.unitPrice"
    ])
    .where("line.companyId", "=", companyId)
    .where("receipt.status", "=", "Posted")
    .where("receipt.sourceDocument", "=", "Purchase Order")
    .where("receipt.postingDate", "<", cutoverDate)
    .where("line.lineId", "is not", null)
    .where("line.receivedQuantity", "<>", 0)
    .execute();
  if (receiptLines.length === 0) return [];

  const receiptIds = [...new Set(receiptLines.map((line) => line.receiptId))];
  const purchaseOrderLineIds = [
    ...new Set(receiptLines.map((line) => line.lineId as string))
  ];
  const receiptPrefix = journalReference.to.receipt("");
  const invoicePrefix = journalReference.to.purchaseInvoice("");

  const [receiptGrIr, receiptLayers, invoiceLines] = await Promise.all([
    db
      .selectFrom("journalLine as line")
      .innerJoin("journal", (join) =>
        join
          .onRef("journal.id", "=", "line.journalId")
          .onRef("journal.companyId", "=", "line.companyId")
      )
      .select([
        "line.documentId",
        "line.documentLineReference",
        sql<number>`sum("line"."amount")`.as("amount")
      ])
      .where("line.companyId", "=", companyId)
      .where("line.accountId", "=", grIrAccountId)
      .where("line.documentId", "in", receiptIds)
      .where("line.documentLineReference", "like", `${receiptPrefix}%`)
      .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
      .groupBy(["line.documentId", "line.documentLineReference"])
      .execute(),
    db
      .selectFrom("costLedger")
      .select([
        "documentId",
        "itemId",
        sql<number>`sum("cost")`.as("cost"),
        sql<number>`sum("quantity")`.as("quantity")
      ])
      .where("companyId", "=", companyId)
      .where("documentType", "=", "Purchase Receipt")
      .where("documentId", "in", receiptIds)
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where("quantity", ">", 0)
      .groupBy(["documentId", "itemId"])
      .execute(),
    db
      .selectFrom("purchaseInvoiceLine as line")
      .innerJoin("purchaseInvoice as invoice", (join) =>
        join
          .onRef("invoice.id", "=", "line.invoiceId")
          .onRef("invoice.companyId", "=", "line.companyId")
      )
      .select([
        "invoice.id as invoiceId",
        "line.purchaseOrderLineId",
        "line.quantity",
        "line.conversionFactor"
      ])
      .where("line.companyId", "=", companyId)
      .where("line.purchaseOrderLineId", "in", purchaseOrderLineIds)
      .where("invoice.status", "not in", ["Draft", "Pending", "Voided"])
      .where("invoice.postingDate", "<", cutoverDate)
      .execute()
  ]);

  const invoiceIds = [...new Set(invoiceLines.map((line) => line.invoiceId))];
  const invoiceJournalLines =
    invoiceIds.length > 0
      ? await db
          .selectFrom("journalLine as line")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "line.journalId")
              .onRef("journal.companyId", "=", "line.companyId")
          )
          .select([
            "line.documentId",
            "line.documentLineReference",
            sql<boolean>`bool_or(
              "line"."accountId" = ${grIrAccountId}
              AND "line"."description" = ${GR_IR_CLEARING_DESCRIPTION}
            )`.as("isClearing"),
            sql<number>`sum("line"."amount") FILTER (
              WHERE "line"."accountId" = ${grIrAccountId}
                AND "line"."description" = ${GR_IR_CLEARING_DESCRIPTION}
            )`.as("amount"),
            sql<number>`sum("line"."quantity") FILTER (
              WHERE "line"."accountId" = ${grIrAccountId}
                AND "line"."description" = ${GR_IR_CLEARING_DESCRIPTION}
            )`.as("quantity")
          ])
          .where("line.companyId", "=", companyId)
          .where("line.documentId", "in", invoiceIds)
          .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
          .groupBy(["line.documentId", "line.documentLineReference"])
          .execute()
      : [];

  // Received before the cutover, per (receipt, PO line): quantity and the
  // cost a receipt with no journal falls back to.
  const layerByReceiptItem = new Map(
    receiptLayers.map((row) => [
      `${row.documentId}:${row.itemId}`,
      { cost: Number(row.cost), quantity: Number(row.quantity) }
    ])
  );
  const grIrByReceiptLine = new Map(
    receiptGrIr.map((row) => [
      `${row.documentId}:${(row.documentLineReference ?? "").slice(receiptPrefix.length)}`,
      Number(row.amount)
    ])
  );
  const received = new Map<
    string,
    { purchaseOrderLineId: string; quantity: number; fallbackCost: number }
  >();
  for (const line of receiptLines) {
    const purchaseOrderLineId = line.lineId as string;
    const quantity = Number(line.receivedQuantity);
    const layer = layerByReceiptItem.get(`${line.receiptId}:${line.itemId}`);
    const fallbackCost =
      quantity > 0 && layer && layer.quantity > EPSILON
        ? (quantity / layer.quantity) * layer.cost
        : quantity * Number(line.unitPrice ?? 0);
    const key = `${line.receiptId}:${purchaseOrderLineId}`;
    const current = received.get(key) ?? {
      purchaseOrderLineId,
      quantity: 0,
      fallbackCost: 0
    };
    current.quantity += quantity;
    current.fallbackCost += fallbackCost;
    received.set(key, current);
  }
  const receivedByLine = new Map<string, { quantity: number; cost: number }>();
  for (const [key, row] of received) {
    const current = receivedByLine.get(row.purchaseOrderLineId) ?? {
      quantity: 0,
      cost: 0
    };
    current.quantity += row.quantity;
    current.cost += grIrByReceiptLine.get(key) ?? row.fallbackCost;
    receivedByLine.set(row.purchaseOrderLineId, current);
  }

  // Cleared before the cutover, per PO line: the GR/IR Clearing lines of the
  // invoices with a journal, and the inventory quantity of those without one.
  const invoicesWithJournal = new Set(
    invoiceJournalLines.map((row) => row.documentId)
  );
  const clearedByLine = new Map<
    string,
    { quantity: number; amount: number; legacyQuantity: number }
  >();
  const cleared = (purchaseOrderLineId: string) => {
    const current = clearedByLine.get(purchaseOrderLineId) ?? {
      quantity: 0,
      amount: 0,
      legacyQuantity: 0
    };
    clearedByLine.set(purchaseOrderLineId, current);
    return current;
  };
  for (const row of invoiceJournalLines) {
    const reference = row.documentLineReference ?? "";
    if (!row.isClearing || !reference.startsWith(invoicePrefix)) continue;
    const current = cleared(reference.slice(invoicePrefix.length));
    current.quantity += Number(row.quantity ?? 0);
    // A debit on the liability: natural-signed negative.
    current.amount -= Number(row.amount ?? 0);
  }
  for (const line of invoiceLines) {
    if (!line.purchaseOrderLineId || invoicesWithJournal.has(line.invoiceId)) {
      continue;
    }
    cleared(line.purchaseOrderLineId).legacyQuantity +=
      Number(line.quantity) * Number(line.conversionFactor ?? 1);
  }

  const items: DraftItem[] = [];
  for (const [purchaseOrderLineId, receipt] of receivedByLine) {
    const clearing = clearedByLine.get(purchaseOrderLineId);
    const unitCost =
      Math.abs(receipt.quantity) > EPSILON
        ? receipt.cost / receipt.quantity
        : 0;
    const legacyQuantity = clearing
      ? Math.min(
          clearing.legacyQuantity,
          Math.max(0, receipt.quantity - clearing.quantity)
        )
      : 0;
    const clearedQuantity = (clearing?.quantity ?? 0) + legacyQuantity;
    const clearedAmount = (clearing?.amount ?? 0) + legacyQuantity * unitCost;
    if (receipt.quantity - clearedQuantity <= EPSILON) continue;
    items.push({
      openItemType: "Received Not Invoiced",
      accountId: grIrAccountId,
      basis: "natural",
      original: round(receipt.cost),
      settled: round(clearedAmount),
      documentType: null,
      documentId: null,
      documentLineReference: journalReference.to.receipt(purchaseOrderLineId),
      description: GOODS_RECEIVED_NOT_INVOICED_DESCRIPTION,
      quantity: round(receipt.quantity),
      settledLine:
        clearedQuantity > EPSILON || Math.abs(clearedAmount) > EPSILON
          ? {
              documentLineReference:
                journalReference.to.purchaseInvoice(purchaseOrderLineId),
              description: GR_IR_CLEARING_DESCRIPTION,
              quantity: round(clearedQuantity)
            }
          : null
    });
  }
  return items;
}

/** The invoice line types a purchase invoice accrues on GR/IR when they
 *  are invoiced before they are received: the item lines except Service,
 *  which the posting expenses to indirect cost. */
const GR_IR_ACCRUING_LINE_TYPES = [
  "Part",
  "Consumable",
  "Fixture",
  "Material",
  "Tool"
] as const;

/**
 * Invoiced, not received: per purchase order line invoiced before the
 * cutover for more than it received before the cutover, the GR/IR accrual
 * the invoices left open. A receipt after the cutover costs the units
 * invoiced before it from the GR/IR accrual lines of
 * `purchase-invoice:<poLineId>` (Σ cost / Σ quantity) and clears them at
 * that cost. The enable supersedes the invoices' journals, so the item
 * carries the open quantity at that unit cost, flagged as an accrual, on
 * `purchase-invoice:<poLineId>` with the posting's description and sign
 * (a debit on GR/IR).
 *
 * The unit cost is that of the invoices' accrual lines. An invoice with no
 * journal (posted before Carbon wrote journals for every company) has none;
 * a PO line with no accrual line takes the average base cost of its invoice
 * lines (price, line freight and tax, without the header freight).
 */
async function getInvoicedNotReceivedItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const grIrAccountId = defaults.goodsReceivedNotInvoicedAccount;
  const invoiceLines = await db
    .selectFrom("purchaseInvoiceLine as line")
    .innerJoin("purchaseInvoice as invoice", (join) =>
      join
        .onRef("invoice.id", "=", "line.invoiceId")
        .onRef("invoice.companyId", "=", "line.companyId")
    )
    .select([
      "invoice.id as invoiceId",
      "line.purchaseOrderLineId",
      "line.quantity",
      "line.conversionFactor",
      "line.unitPrice",
      "line.shippingCost",
      "line.taxAmount"
    ])
    .where("line.companyId", "=", companyId)
    .where("line.purchaseOrderLineId", "is not", null)
    .where("line.invoiceLineType", "in", [...GR_IR_ACCRUING_LINE_TYPES])
    .where("invoice.status", "not in", ["Draft", "Pending", "Voided"])
    .where("invoice.postingDate", "<", cutoverDate)
    .execute();
  if (invoiceLines.length === 0) return [];

  const invoiced = new Map<string, { quantity: number; cost: number }>();
  for (const line of invoiceLines) {
    const purchaseOrderLineId = line.purchaseOrderLineId as string;
    const current = invoiced.get(purchaseOrderLineId) ?? {
      quantity: 0,
      cost: 0
    };
    current.quantity +=
      Number(line.quantity) * Number(line.conversionFactor ?? 1);
    current.cost +=
      Number(line.quantity) * Number(line.unitPrice ?? 0) +
      Number(line.shippingCost ?? 0) +
      Number(line.taxAmount ?? 0);
    invoiced.set(purchaseOrderLineId, current);
  }
  const purchaseOrderLineIds = [...invoiced.keys()];
  const invoiceIds = [...new Set(invoiceLines.map((line) => line.invoiceId))];

  const [receiptLines, accrualLines] = await Promise.all([
    db
      .selectFrom("receiptLine as line")
      .innerJoin("receipt", (join) =>
        join
          .onRef("receipt.id", "=", "line.receiptId")
          .onRef("receipt.companyId", "=", "line.companyId")
      )
      .select([
        "line.lineId",
        sql<number>`sum("line"."receivedQuantity")`.as("quantity")
      ])
      .where("line.companyId", "=", companyId)
      .where("receipt.status", "=", "Posted")
      .where("receipt.sourceDocument", "=", "Purchase Order")
      .where("receipt.postingDate", "<", cutoverDate)
      .where("line.lineId", "in", purchaseOrderLineIds)
      .groupBy("line.lineId")
      .execute(),
    // The invoices' GR/IR accrual lines, as post-receipt reads them: a debit
    // (non-positive amount) with a positive quantity. A Superseded journal
    // is read too, in case the enable has already superseded them.
    db
      .selectFrom("journalLine as line")
      .innerJoin("journal", (join) =>
        join
          .onRef("journal.id", "=", "line.journalId")
          .onRef("journal.companyId", "=", "line.companyId")
      )
      .select([
        "line.documentLineReference",
        sql<number>`sum(-"line"."amount")`.as("cost"),
        sql<number>`sum("line"."quantity")`.as("quantity")
      ])
      .where("line.companyId", "=", companyId)
      .where("line.accountId", "=", grIrAccountId)
      .where("line.accrual", "=", true)
      .where("line.documentId", "in", invoiceIds)
      .where(
        "line.documentLineReference",
        "in",
        purchaseOrderLineIds.map((id) =>
          journalReference.to.purchaseInvoice(id)
        )
      )
      .where("line.amount", "<=", 0)
      .where("line.quantity", ">", 0)
      .where("journal.status", "in", [
        ...DOCUMENT_JOURNAL_STATUSES,
        "Superseded"
      ])
      .groupBy("line.documentLineReference")
      .execute()
  ]);

  const receivedByLine = new Map(
    receiptLines.map((row) => [row.lineId as string, Number(row.quantity)])
  );
  const invoicePrefix = journalReference.to.purchaseInvoice("");
  const accrualByLine = new Map(
    accrualLines.map((row) => [
      (row.documentLineReference ?? "").slice(invoicePrefix.length),
      { cost: Number(row.cost), quantity: Number(row.quantity) }
    ])
  );

  const items: DraftItem[] = [];
  for (const [purchaseOrderLineId, invoice] of invoiced) {
    const open =
      invoice.quantity - (receivedByLine.get(purchaseOrderLineId) ?? 0);
    if (open <= EPSILON) continue;
    const accrual = accrualByLine.get(purchaseOrderLineId);
    const unitCost =
      accrual && accrual.quantity > EPSILON
        ? accrual.cost / accrual.quantity
        : invoice.quantity > EPSILON
          ? invoice.cost / invoice.quantity
          : 0;
    items.push({
      openItemType: "Invoiced Not Received",
      accountId: grIrAccountId,
      basis: "natural",
      original: round(debit("liability", open * unitCost)),
      settled: 0,
      documentType: null,
      documentId: null,
      documentLineReference:
        journalReference.to.purchaseInvoice(purchaseOrderLineId),
      description: GR_IR_CLEARING_DESCRIPTION,
      quantity: round(open),
      accrual: true
    });
  }
  return items;
}

/**
 * Work in progress: per job, its lines on the WIP account dated before the
 * cutover, as `close-job` sums them. Every job with a balance, whatever its
 * status, so the account's opening balance is the sum of its jobs.
 */
async function getWorkInProgressItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const rows = await db
    .selectFrom("journalLine as line")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .innerJoin("job", (join) =>
      join
        .onRef("job.id", "=", "line.documentId")
        .onRef("job.companyId", "=", "line.companyId")
    )
    .select([
      "job.id as jobId",
      sql<number>`sum("line"."amount")`.as("balance")
    ])
    .where("line.companyId", "=", companyId)
    .where("line.accountId", "=", defaults.workInProgressAccount)
    .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
    .where("journal.postingDate", "<", cutoverDate)
    .groupBy("job.id")
    .execute();
  return rows.map((row) => ({
    openItemType: "Work in Progress",
    accountId: defaults.workInProgressAccount,
    basis: "natural",
    original: round(Number(row.balance)),
    settled: 0,
    documentType: null,
    documentId: row.jobId,
    documentLineReference: null,
    description: "WIP Account"
  }));
}

/**
 * Deferred revenue: the Deferral rows dated on or after the cutover of sales
 * invoices posted before it, per invoice line, that were still deferred the
 * day before the cutover. The balance sits on
 * the row's DEBIT account (the deferred revenue liability the run debits);
 * its credit account is the revenue the run credits.
 */
async function getDeferredRevenueItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const rows = await db
    .selectFrom("revenueRecognitionSchedule as schedule")
    .innerJoin("salesInvoiceLine as line", (join) =>
      join
        .onRef("line.id", "=", "schedule.salesInvoiceLineId")
        .onRef("line.companyId", "=", "schedule.companyId")
    )
    .innerJoin("salesInvoice as invoice", (join) =>
      join
        .onRef("invoice.id", "=", "line.invoiceId")
        .onRef("invoice.companyId", "=", "line.companyId")
    )
    .select([
      "invoice.id as invoiceId",
      "line.id as invoiceLineId",
      "schedule.debitAccountId",
      sql<number>`sum("schedule"."amount")`.as("amount")
    ])
    .where("schedule.companyId", "=", companyId)
    .where("schedule.type", "=", "Deferral")
    // Still deferred the day before the cutover: Planned, or Posted by a run
    // whose journal the reset deleted. The enable writes that run's journal
    // again (activate-accounting/legacy/runs.ts), and it debits this balance.
    .where((eb) =>
      eb.or([
        eb("schedule.status", "=", "Planned"),
        eb.and([
          eb("schedule.status", "=", "Posted"),
          eb("schedule.journalId", "is", null),
          eb("schedule.runLineId", "is not", null)
        ])
      ])
    )
    .where("schedule.scheduledDate", ">=", cutoverDate)
    .where("invoice.postingDate", "<", cutoverDate)
    .where("invoice.status", "not in", ["Draft", "Pending", "Voided"])
    .groupBy(["invoice.id", "line.id", "schedule.debitAccountId"])
    .execute();
  return rows.map((row) => {
    // Before the cutover an empty deferred revenue default wrote the row on
    // retained earnings; the enable re-points it.
    const accountId =
      row.debitAccountId === defaults.retainedEarningsAccount
        ? defaults.deferredRevenueAccount
        : row.debitAccountId;
    if (!accountId) {
      throw new Error("Set the deferredRevenueAccount account default");
    }
    return {
      openItemType: "Deferred Revenue",
      accountId,
      basis: "debit",
      // A credit balance: the run will debit it.
      original: -round(Number(row.amount)),
      settled: 0,
      documentType: "Invoice",
      documentId: row.invoiceId,
      documentLineReference: journalReference.to.salesInvoice(
        row.invoiceLineId
      ),
      description: "Deferred Revenue"
    };
  });
}

/**
 * Lease net investment: per rental agreement, the closing net investment of
 * each lease line commenced before the cutover at its last schedule line
 * before the cutover, or its initial net investment when no schedule line
 * falls before it. Read from the lease rows, not the commencement journal:
 * a lease commenced before the reset has none. Commencement sells the unit
 * to the lease, so the date is its asset's disposal date.
 */
async function getLeaseNetInvestmentItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const leaseLines = await db
    .selectFrom("rentalAgreementLine as line")
    .innerJoin("rentalAgreement as agreement", (join) =>
      join
        .onRef("agreement.id", "=", "line.rentalAgreementId")
        .onRef("agreement.companyId", "=", "line.companyId")
    )
    .innerJoin("fixedAsset as asset", (join) =>
      join
        .onRef("asset.id", "=", "line.fixedAssetId")
        .onRef("asset.companyId", "=", "line.companyId")
    )
    .select([
      "line.id",
      "line.rentalAgreementId",
      "line.initialNetInvestment",
      "agreement.exchangeRate"
    ])
    .where("line.companyId", "=", companyId)
    .where("line.lessorClassification", "=", "Sale")
    .where("line.initialNetInvestment", "is not", null)
    .where("asset.disposalDate", "<", cutoverDate)
    .execute();
  if (leaseLines.length === 0) return [];

  const lastScheduleLines = await db
    .selectFrom("rentalLeaseScheduleLine")
    .distinctOn("rentalAgreementLineId")
    .select(["rentalAgreementLineId", "closingNetInvestment"])
    .where("companyId", "=", companyId)
    .where(
      "rentalAgreementLineId",
      "in",
      leaseLines.map((line) => line.id)
    )
    .where("periodDate", "<", cutoverDate)
    .orderBy("rentalAgreementLineId")
    .orderBy("periodDate", "desc")
    .execute();
  const closingByLine = new Map(
    lastScheduleLines.map((row) => [
      row.rentalAgreementLineId,
      Number(row.closingNetInvestment)
    ])
  );

  const byAgreement = new Map<string, number>();
  for (const line of leaseLines) {
    const netInvestment =
      closingByLine.get(line.id) ?? Number(line.initialNetInvestment ?? 0);
    const rate = Number(line.exchangeRate ?? 1) || 1;
    addTo(byAgreement, line.rentalAgreementId, netInvestment / rate);
  }
  const accountId = defaults.netInvestmentInLeasesAccount;
  const items: DraftItem[] = [];
  for (const [rentalAgreementId, netInvestment] of byAgreement) {
    if (Math.abs(netInvestment) <= EPSILON) continue;
    if (!accountId) {
      throw new Error("Set the netInvestmentInLeasesAccount account default");
    }
    items.push({
      openItemType: "Lease Net Investment",
      accountId,
      basis: "debit",
      original: round(netInvestment),
      settled: 0,
      documentType: "Rental Agreement",
      documentId: rentalAgreementId,
      documentLineReference: null,
      description: "Net Investment in Leases"
    });
  }
  return items;
}

/** Converts draft items to open items, signed for each account's class. */
export async function finishItems(
  db: CutoverDb,
  companyGroupId: string,
  drafts: DraftItem[]
): Promise<OpenItem[]> {
  const accounts = await getAccounts(
    db,
    companyGroupId,
    drafts.map((item) => item.accountId)
  );
  const items: OpenItem[] = [];
  for (const draft of drafts) {
    const accountClass = requireClass(accounts, draft.accountId);
    const sign = (value: number) =>
      draft.basis === "debit" ? debitSigned(accountClass, value) : value;
    const originalAmount = round(sign(draft.original));
    const settledBeforeCutover = round(sign(draft.settled));
    const amount = round(originalAmount - settledBeforeCutover);
    if (Math.abs(amount) <= EPSILON && !draft.accrual) continue;
    items.push({
      openItemType: draft.openItemType,
      accountId: draft.accountId,
      accountClass,
      amount,
      originalAmount,
      settledBeforeCutover,
      documentType: draft.documentType,
      documentId: draft.documentId,
      documentLineReference: draft.documentLineReference,
      description: draft.description,
      ...(draft.quantity != null ? { quantity: draft.quantity } : {}),
      ...(draft.accrual ? { accrual: true } : {}),
      ...(draft.settledLine ? { settled: draft.settledLine } : {})
    });
  }
  return items;
}

/**
 * Every document-level item open at the cutover, in base currency, positive
 * on the natural side of its account: receivables, payables, employee
 * reimbursements, unapplied credit, deposits, received-not-invoiced,
 * invoiced-not-received, work in progress, deferred revenue and lease net investment. Inventory and fixed assets come from
 * `getCutoverInventory` and `getCutoverFixedAssets`.
 */
export async function getCutoverOpenItems(
  db: CutoverDb,
  args: CutoverArgs
): Promise<OpenItem[]> {
  return openItemsFor(db, await loadCutoverContext(db, args));
}

/** `getCutoverOpenItems` for a company and defaults already read. */
export async function openItemsFor(
  db: CutoverDb,
  { companyId, cutoverDate, company, defaults }: CutoverContext
): Promise<OpenItem[]> {
  const settlements = await getSettlementsBeforeCutover(
    db,
    companyId,
    cutoverDate
  );
  const groups = await Promise.all([
    getReceivableAndPayableItems(
      db,
      companyId,
      cutoverDate,
      defaults,
      settlements
    ),
    getReimbursementItems(db, companyId, cutoverDate, defaults, settlements),
    getUnappliedPaymentItems(db, companyId, cutoverDate, defaults, settlements),
    getReceivedNotInvoicedItems(db, companyId, cutoverDate, defaults),
    getInvoicedNotReceivedItems(db, companyId, cutoverDate, defaults),
    getWorkInProgressItems(db, companyId, cutoverDate, defaults),
    getDeferredRevenueItems(db, companyId, cutoverDate, defaults),
    getLeaseNetInvestmentItems(db, companyId, cutoverDate, defaults)
  ]);
  return finishItems(db, company.companyGroupId, groups.flat());
}
