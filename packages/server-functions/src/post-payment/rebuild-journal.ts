// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A payment's journal built again from its stored row and settlements
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md sections 5a and 6).
// The void of a payment dated before the cutover negates it, so it nets the
// opening lines; the enable writes it for the payments posted with no
// journal. The input is assembled as the posting assembles it
// (`journal-input.ts`), so the rebuilt lines are the posted lines.

import type { KyselyDatabase } from "@carbon/database/client";
import type { AutomaticJournalStatus } from "@carbon/database/journal-posting-status";
import { readPaymentProcessorFees } from "@carbon/database/payment-processor-fee";
import type { PaymentJournalFeeInput } from "@carbon/database/posting";
import {
  CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION,
  CUSTOMER_DEPOSIT_DESCRIPTION,
  EPSILON,
  equals,
  onAccountCreditDescription,
  round,
  toBaseAmount
} from "@carbon/utils";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import { assertNoMigrationClearing } from "../lib/cutover-void";
import { loadPartyDimensions } from "../lib/party-dimensions";
import {
  assemblePaymentJournal,
  foldSourceControls,
  foldTargetControls,
  type PaymentApplication,
  type PaymentJournalLineWithRole,
  type PaymentRow,
  paymentControlAccount,
  paymentDimensions,
  paymentKind,
  readDiscountAccountClasses,
  readPaymentParties,
  readSourceControlLines,
  readTargetControlLines,
  type SourceControlLine
} from "./journal-input";

type Trx = Transaction<KyselyDatabase>;

/** A payment's journal built again: its lines, each with the stand-in role
 *  its posting gives it, and the party dimensions every line carries. */
export type RebuiltPaymentJournal = {
  lines: PaymentJournalLineWithRole[];
  dimensions: { dimensionId: string; valueId: string }[];
};

function principal(value: number | null, label: string): number {
  if (value === null || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`Missing or invalid source principal for ${label}`);
  }
  return Number(value);
}

/**
 * What the funding allocation left of the current cash, from the stored
 * settlements. `allocatePaymentFunding` starts the current payment at its
 * gross base and draws down, per application it funds, the carrying value
 * the application released (`sourceBaseAmount`), rounding at each step. The
 * settlement stores that value as its applied amount and realized FX:
 * `calculateSettlementFx` is `sourceBase − applied` for cash in and
 * `applied − sourceBase` for cash out. So this is the number the posting
 * passed as `newOnAccountBase`.
 */
export function storedOnAccountRemainder(
  payment: Pick<PaymentRow, "totalAmount" | "exchangeRate">,
  applications: PaymentApplication[],
  cashIn: boolean
): number {
  let remaining = toBaseAmount(
    Number(payment.totalAmount),
    Number(payment.exchangeRate)
  );
  for (const application of applications) {
    if (application.sourcePaymentId) continue;
    const released = round(
      application.appliedAmount +
        (cashIn ? application.fxGainLossAmount : -application.fxGainLossAmount)
    );
    remaining = round(remaining - released);
  }
  return remaining;
}

/**
 * The journals of many payments of one company, built again in a fixed
 * number of reads.
 *
 * - `postingStatus` is the status the journal posts with. It decides the
 *   control account as the posting does (`paymentControlAccount`).
 * - `feeByPaymentId` is the processor fee each payment withheld
 *   (`readPaymentProcessorFees`).
 * - A target or funding source books to the control account of its line in
 *   a Provisional or Posted journal (the opening journal for a document open
 *   at the cutover), else to the control account, as the posting does.
 * - Payments are built in the order given. A payment that an earlier one in
 *   the list funds from on-account credit books that credit to the control
 *   account the earlier one was just built with, as its posting read it from
 *   the earlier payment's journal.
 */
export async function rebuildPaymentJournals(
  trx: Trx,
  payments: PaymentRow[],
  companyId: string,
  options: {
    postingStatus: AutomaticJournalStatus;
    feeByPaymentId: Map<string, PaymentJournalFeeInput>;
  }
): Promise<RebuiltPaymentJournal[]> {
  if (payments.length === 0) return [];
  const { postingStatus, feeByPaymentId } = options;
  const kinds = payments.map(paymentKind);
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  if (!company.companyGroupId) {
    throw new Error("Payment currency configuration is missing");
  }
  const companyGroupId = company.companyGroupId;
  const defaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) {
    throw new Error("Accounting defaults are required before posting");
  }
  const partyOf = await readPaymentParties(trx, companyId, kinds);
  const discountClasses = await readDiscountAccountClasses(
    trx,
    companyGroupId,
    defaults
  );

  const settlements = await trx
    .selectFrom("invoiceSettlement")
    .selectAll()
    .where("companyId", "=", companyId)
    .where(
      "paymentId",
      "in",
      payments.map((payment) => payment.id)
    )
    .orderBy("id")
    .execute();
  const settlementsByPayment = new Map<string, typeof settlements>();
  for (const row of settlements) {
    const list = settlementsByPayment.get(row.paymentId!) ?? [];
    list.push(row);
    settlementsByPayment.set(row.paymentId!, list);
  }

  const targetIds = [
    ...new Set(
      payments.flatMap((payment, index) =>
        (settlementsByPayment.get(payment.id) ?? []).flatMap((row) => {
          const target = row[kinds[index]!.targetColumn];
          return target ? [target] : [];
        })
      )
    )
  ];
  const sourceIds = [
    ...new Set(
      settlements.flatMap((row) =>
        row.sourcePaymentId ? [row.sourcePaymentId] : []
      )
    )
  ];
  const [targetLines, sourceLines] = await Promise.all([
    readTargetControlLines(trx, companyId, targetIds),
    readSourceControlLines(trx, companyId, sourceIds)
  ]);
  // The on-account and deposit lines of the payments built here, for the
  // later payments they fund.
  const builtSourceLines: SourceControlLine[] = [];

  const dimensions = kinds.some((kind) => !kind.isReimbursement)
    ? await loadPartyDimensions(trx, companyGroupId)
    : [];

  return payments.map((payment, index) => {
    const kind = kinds[index]!;
    const party = partyOf(kind);
    const rows = settlementsByPayment.get(payment.id) ?? [];
    const ownTargets = new Set(rows.map((row) => row[kind.targetColumn]));
    const ownSources = new Set(rows.map((row) => row.sourcePaymentId));
    const applications: PaymentApplication[] = rows.map((row) => ({
      targetSalesInvoiceId: row.targetSalesInvoiceId,
      targetPurchaseInvoiceId: row.targetPurchaseInvoiceId,
      targetMemoId: row.targetMemoId,
      targetReimbursementId: row.targetReimbursementId,
      sourcePaymentId: row.sourcePaymentId,
      sourceAmount: principal(row.sourceAmount, row.id),
      sourceExchangeRate: Number(row.sourceExchangeRate),
      targetExchangeRate: Number(row.targetExchangeRate),
      appliedAmount: Number(row.appliedAmount),
      discountAmount: Number(row.discountAmount),
      writeOffAmount: Number(row.writeOffAmount),
      fxGainLossAmount: Number(row.fxGainLossAmount)
    }));

    const { lines } = assemblePaymentJournal({
      payment,
      kind,
      companyId,
      defaults,
      control: paymentControlAccount(kind, party, defaults, postingStatus),
      discountClasses,
      targets: foldTargetControls(
        kind,
        targetLines.filter((line) => ownTargets.has(line.documentId))
      ),
      sources: foldSourceControls(
        kind,
        [...sourceLines, ...builtSourceLines].filter((line) =>
          ownSources.has(line.documentId)
        )
      ),
      applications,
      newOnAccountBase: storedOnAccountRemainder(
        payment,
        applications,
        kind.cashIn
      ),
      fee: feeByPaymentId.get(payment.id),
      journalLineReference: nanoid()
    });
    assertNoMigrationClearing(lines, defaults.migrationClearingAccount);

    for (const line of lines) {
      if (kind.sourceDescriptions.includes(line.description)) {
        builtSourceLines.push({
          documentId: payment.id,
          accountId: line.accountId,
          description: line.description,
          accountDefaultRole: line.accountDefaultRole
        });
      }
    }

    return {
      lines,
      dimensions: paymentDimensions(dimensions, kind, party)
    };
  });
}

/**
 * The journal of a payment dated before the cutover, built again for its
 * void. The processor fee comes from the payment's integration mapping
 * (`readPaymentProcessorFees`); a payment with no mapping row has its fee
 * read off its own journal (`postedProcessorFee`).
 */
export async function rebuildPaymentJournal(
  trx: Trx,
  payment: PaymentRow,
  companyId: string,
  postingStatus: AutomaticJournalStatus
): Promise<RebuiltPaymentJournal> {
  const { fees, mapped } = await readPaymentProcessorFees(trx, companyId, [
    payment
  ]);
  const fee =
    fees.get(payment.id) ??
    (mapped.has(payment.id)
      ? undefined
      : await postedProcessorFee(trx, payment, companyId));
  const [rebuilt] = await rebuildPaymentJournals(trx, [payment], companyId, {
    postingStatus,
    feeByPaymentId: new Map(fee ? [[payment.id, fee]] : [])
  });
  return rebuilt!;
}

/** Every description `buildPaymentJournal` writes, except the processor fee's. */
const PAYMENT_BUILDER_DESCRIPTIONS = new Set([
  "Bank / Cash",
  "Accounts Receivable",
  "Accounts Payable",
  "Employee Reimbursements Payable",
  "Customer Payment Discount",
  "Supplier Payment Discount",
  "Bad Debt Expense",
  "Vendor Write-Off Income",
  "Accounts Receivable (credit applied)",
  "Accounts Payable (credit applied)",
  "Realized FX Gain",
  "Realized FX Loss",
  onAccountCreditDescription(true),
  onAccountCreditDescription(false),
  CUSTOMER_DEPOSIT_DESCRIPTION,
  CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION
]);

/**
 * The processor fee of a payment with no integration mapping, read off the
 * payment's own journal: the bank line is short of the gross cash by the
 * fee, and the fee line is the one line the builder does not describe. A
 * payment with no journal has no fee here.
 */
async function postedProcessorFee(
  trx: Trx,
  payment: PaymentRow,
  companyId: string
): Promise<PaymentJournalFeeInput | undefined> {
  if (!payment.journalId) return undefined;
  const grossBase = toBaseAmount(
    Number(payment.totalAmount),
    Number(payment.exchangeRate)
  );
  const lines = await trx
    .selectFrom("journalLine")
    .select(["accountId", "amount", "description"])
    .where("companyId", "=", companyId)
    .where("journalId", "=", payment.journalId)
    .where("documentType", "=", "Payment")
    .where("documentId", "=", payment.id)
    .execute();
  const bank = lines.find((line) => line.description === "Bank / Cash");
  if (!bank) return undefined;
  const feeBase = round(grossBase - Math.abs(Number(bank.amount)));
  if (Math.abs(feeBase) <= EPSILON) return undefined;
  const fees = lines.filter(
    (line) => !PAYMENT_BUILDER_DESCRIPTIONS.has(line.description ?? "")
  );
  if (
    fees.length !== 1 ||
    !fees[0]!.accountId ||
    !equals(Math.abs(Number(fees[0]!.amount)), feeBase)
  ) {
    throw new Error(
      "The payment's processor fee cannot be read from its journal"
    );
  }
  return {
    // The builder converts the fee at the payment's rate; this is its inverse.
    amount: round(feeBase * Number(payment.exchangeRate)),
    accountId: fees[0]!.accountId,
    description: fees[0]!.description ?? undefined
  };
}
