// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isBeforeCutover } from "@carbon/database/accounting-cutover-dates";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  type InvoiceDocumentIds,
  loadDepositScope,
  loadSalesInvoiceDocumentIds
} from "@carbon/database/deposit-scope";
import {
  postingStatusFor,
  readAccountingCutoverDate
} from "@carbon/database/journal-posting-status";
import type { PaymentJournalFeeInput } from "@carbon/database/posting";
import { getNextSequence } from "@carbon/database/sequence";
import {
  allocatePaymentFunding,
  assertCurrencyDecimals,
  assertExchangeRate,
  datetime,
  type FundingRequest,
  fundingScopeOf,
  invoiceRemainingAmounts,
  isEffectiveSettlement,
  remainingFundingSources,
  round,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import { type Kysely, sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { NotFoundError } from "../errors";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import { loadPartyDimensions } from "../lib/party-dimensions";
import {
  assemblePaymentJournal,
  foldSourceControls,
  foldTargetControls,
  paymentControlAccount,
  paymentDimensions,
  paymentKind,
  readDiscountAccountClasses,
  readPaymentParties,
  readSourceControlLines,
  readTargetControlLines
} from "./journal-input";
import { rebuildPaymentJournal } from "./rebuild-journal";

export type PostPaymentArgs = {
  type: "post" | "void";
  paymentId: string;
  companyId: string;
  userId: string;
  today: string;
  fee?: PaymentJournalFeeInput;
};

function settlementQuery(trx: Transaction<KyselyDatabase>, companyId: string) {
  return trx
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
    .selectAll("s")
    .select([
      "p.status as paymentStatus",
      "m.status as memoStatus",
      "vp.status as viaStatus"
    ])
    .where("s.companyId", "=", companyId);
}

function principal(value: number | null, label: string): number {
  if (value === null || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`Missing or invalid source principal for ${label}`);
  }
  return Number(value);
}

/** The endpoint's single commit boundary; every monetary snapshot is read under locks. */
export function postPaymentTransaction(
  db: Kysely<KyselyDatabase>,
  args: PostPaymentArgs
): Promise<{ journalId: string | null }> {
  const { companyId, paymentId, userId, today, fee, type } = args;
  return db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom("payment")
      .selectAll()
      .where("id", "=", paymentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw new NotFoundError("Payment not found");
    if (type === "post" && payment.status === "Posted") {
      return { journalId: payment.journalId };
    }
    if (type === "void" && payment.status === "Voided") {
      return { journalId: payment.journalId };
    }
    if (payment.status !== (type === "post" ? "Draft" : "Posted")) {
      throw new Error(`Cannot ${type} payment in status ${payment.status}`);
    }

    // Every payment posts a journal: Provisional before the company's
    // accounting cutover, Posted after it. FOR SHARE holds the cutover until
    // commit. A Provisional journal has no accounting period.
    const cutoverDate = await readAccountingCutoverDate(trx, companyId);
    const postingStatus = postingStatusFor(cutoverDate);
    const timestamp = datetime.timestamp();
    let accountingPeriodId: string | null = null;
    if (postingStatus === "Posted") {
      accountingPeriodId = await getCurrentAccountingPeriod(
        companyId,
        trx,
        today
      );
      // The reader also checks period status, but the row lock protects the
      // posting against a concurrent close/lock after that read.
      const period = await trx
        .selectFrom("accountingPeriod")
        .select(["id", "closeStatus"])
        .where("id", "=", accountingPeriodId)
        .where("companyId", "=", companyId)
        .forShare()
        .executeTakeFirst();
      if (
        !period ||
        period.closeStatus === "Closed" ||
        period.closeStatus === "Locked"
      )
        throw new Error("Accounting period is closed or locked");
    }

    if (type === "void") {
      const consumers = await settlementQuery(trx, companyId)
        .where("s.sourcePaymentId", "=", paymentId)
        .execute();
      if (
        consumers.some(
          (row) =>
            isEffectiveSettlement(row) &&
            principal(row.sourceAmount, row.id) > 0
        )
      ) {
        throw new Error(
          "Cannot void a funding source while posted payments consume its credit"
        );
      }
      let reversalId: string | null = null;
      const insertVoidJournal = async () =>
        (
          await trx
            .insertInto("journal")
            .values({
              journalEntryId: await getNextSequence(
                trx,
                "journalEntry",
                companyId
              ),
              accountingPeriodId,
              description: `VOID Payment ${payment.paymentId}`,
              postingDate: today,
              companyId,
              sourceType: "Payment",
              status: postingStatus,
              postedAt: timestamp,
              postedBy: userId,
              createdBy: userId
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      // Before the cutover the payment's own journal is Superseded, and the
      // opening journal carries what the payment left open. The void builds
      // the payment's posting again and negates it, today, so it nets those
      // opening lines.
      if (
        payment.postingDate &&
        isBeforeCutover(payment.postingDate, cutoverDate)
      ) {
        const rebuilt = await rebuildPaymentJournal(
          trx,
          payment,
          companyId,
          postingStatus
        );
        if (rebuilt.lines.length) {
          reversalId = await insertVoidJournal();
          const lines = await trx
            .insertInto("journalLine")
            .values(
              rebuilt.lines.map((line) => ({
                journalId: reversalId!,
                accountId: line.accountId,
                amount: -line.amount,
                quantity: line.quantity,
                description: `VOID: ${line.description}`,
                documentType: "Payment" as const,
                documentId: paymentId,
                documentLineReference: line.documentLineReference ?? null,
                journalLineReference: line.journalLineReference,
                accountDefaultRole: line.accountDefaultRole,
                companyId
              }))
            )
            .returning("id")
            .execute();
          const values = rebuilt.dimensions.flatMap((dimension) =>
            lines.map((line) => ({
              journalLineId: line.id,
              ...dimension,
              companyId
            }))
          );
          if (values.length) {
            await trx
              .insertInto("journalLineDimension")
              .values(values)
              .execute();
          }
        }
      } else if (payment.journalId) {
        const original = await trx
          .selectFrom("journalLine")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "journalLine.journalId")
              .onRef("journal.companyId", "=", "journalLine.companyId")
          )
          .selectAll("journalLine")
          .where("journalLine.journalId", "=", payment.journalId)
          .where("journalLine.companyId", "=", companyId)
          .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
          .orderBy("journalLine.id")
          .execute();
        if (original.length) {
          const reversedId = await insertVoidJournal();
          reversalId = reversedId;
          const lines = await trx
            .insertInto("journalLine")
            .values(
              original.map((line) => ({
                journalId: reversedId,
                accountId: line.accountId,
                amount: -Number(line.amount),
                quantity: line.quantity,
                description: `VOID: ${line.description ?? ""}`,
                documentType: "Payment" as const,
                documentId: paymentId,
                documentLineReference: line.documentLineReference,
                journalLineReference: line.journalLineReference,
                accountDefaultRole: line.accountDefaultRole,
                companyId
              }))
            )
            .returning("id")
            .execute();
          const dimensions = await trx
            .selectFrom("journalLineDimension")
            .select(["journalLineId", "dimensionId", "valueId"])
            .where("companyId", "=", companyId)
            .where(
              "journalLineId",
              "in",
              original.map((line) => line.id)
            )
            .execute();
          const reverseIdByOriginal = new Map(
            original.map((line, index) => [line.id, lines[index]!.id])
          );
          if (dimensions.length) {
            await trx
              .insertInto("journalLineDimension")
              .values(
                dimensions.map((dimension) => ({
                  ...dimension,
                  journalLineId: reverseIdByOriginal.get(
                    dimension.journalLineId
                  )!,
                  companyId
                }))
              )
              .execute();
          }
        }
      }
      await trx
        .updateTable("payment")
        .set({
          status: "Voided",
          voidedAt: timestamp,
          voidedBy: userId,
          updatedAt: timestamp,
          updatedBy: userId
        })
        .where("id", "=", paymentId)
        .where("companyId", "=", companyId)
        .execute();
      return { journalId: reversalId };
    }

    const kind = paymentKind(payment);
    const { isAR, isReimbursement, cashIn, isRefund, isDeposit, partyId } =
      kind;
    if (isReimbursement && cashIn) {
      throw new Error("An employee payment must be a disbursement");
    }
    assertExchangeRate(Number(payment.exchangeRate));
    const company = await trx
      .selectFrom("company")
      .select(["companyGroupId", "baseCurrencyCode"])
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    if (!company.companyGroupId || !payment.currencyCode) {
      throw new Error("Payment currency configuration is missing");
    }
    const currency = await trx
      .selectFrom("currency")
      .select("decimalPlaces")
      .where("code", "=", payment.currencyCode)
      .where("companyGroupId", "=", company.companyGroupId)
      .executeTakeFirst();
    if (!currency || currency.decimalPlaces === null) {
      throw new Error("Payment currency decimal places are not configured");
    }
    const decimals = currency.decimalPlaces;
    assertCurrencyDecimals(decimals);
    if (
      company.baseCurrencyCode === payment.currencyCode &&
      Number(payment.exchangeRate) !== 1
    )
      throw new Error("Base-currency payment must use exchange rate 1");

    const drafts = await trx
      .selectFrom("invoiceSettlement")
      .selectAll()
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("paymentId", "=", paymentId),
          eb("appliedViaPaymentId", "=", paymentId)
        ])
      )
      .orderBy("id")
      .execute();
    const targetColumn = kind.targetColumn;
    for (const draft of drafts) {
      if (
        !draft[targetColumn] ||
        (isReimbursement
          ? // A reimbursement payout carries no other target, no memo/prior-
            // credit funding source (an employee has neither), and no trade
            // discount or write-off.
            draft.targetSalesInvoiceId ||
            draft.targetPurchaseInvoiceId ||
            draft.targetMemoId ||
            draft.memoId ||
            draft.sourcePaymentId ||
            Number(draft.discountAmount) !== 0 ||
            Number(draft.writeOffAmount) !== 0
          : isRefund
            ? draft.targetSalesInvoiceId ||
              draft.targetPurchaseInvoiceId ||
              draft.targetReimbursementId ||
              draft.memoId ||
              draft.sourcePaymentId ||
              Number(draft.discountAmount) !== 0 ||
              Number(draft.writeOffAmount) !== 0
            : draft.targetMemoId ||
              draft.targetReimbursementId ||
              (isAR
                ? draft.targetPurchaseInvoiceId
                : draft.targetSalesInvoiceId))
      )
        throw new Error("Unsupported payment settlement target");
    }
    const targetIds = [
      ...new Set(drafts.map((draft) => draft[targetColumn]!))
    ].sort();
    const memoIds = [
      ...new Set(
        drafts.flatMap((draft) => (draft.memoId ? [draft.memoId] : []))
      )
    ].sort();
    const refundMemos =
      isRefund && targetIds.length
        ? await trx
            .selectFrom("memo")
            .selectAll()
            .where("companyId", "=", companyId)
            .where("id", "in", targetIds)
            .orderBy("id")
            .forUpdate()
            .execute()
        : [];
    // `payableAccountId` is stamped onto the row when the reimbursement posts,
    // so the payout debits the account the liability was actually booked to —
    // never today's `accountDefault`, which may have changed since.
    const reimbursements =
      isReimbursement && targetIds.length
        ? await trx
            .selectFrom("reimbursement")
            .select([
              "id",
              "employeeId as partyId",
              "status",
              "currencyCode",
              "exchangeRate",
              "amount",
              "payableAccountId"
            ])
            .where("companyId", "=", companyId)
            .where("id", "in", targetIds)
            .orderBy("id")
            .forUpdate()
            .execute()
        : [];
    const invoices = isReimbursement
      ? reimbursements
      : isRefund
        ? refundMemos.map((memo) => ({
            ...memo,
            partyId: isAR ? memo.customerId : memo.supplierId
          }))
        : targetIds.length
          ? await (isAR
              ? trx
                  .selectFrom("salesInvoice")
                  .select([
                    "id",
                    "customerId as partyId",
                    "status",
                    "currencyCode",
                    "exchangeRate"
                  ])
                  .where("companyId", "=", companyId)
                  .where("id", "in", targetIds)
                  .orderBy("id")
                  .forUpdate()
                  .execute()
              : trx
                  .selectFrom("purchaseInvoice")
                  .select([
                    "id",
                    "supplierId as partyId",
                    "status",
                    "currencyCode",
                    "exchangeRate"
                  ])
                  .where("companyId", "=", companyId)
                  .where("id", "in", targetIds)
                  .orderBy("id")
                  .forUpdate()
                  .execute())
          : [];
    const totals = isReimbursement
      ? reimbursements.map((reimbursement) => ({
          id: reimbursement.id,
          totalAmount: toBaseAmount(
            Number(reimbursement.amount),
            Number(reimbursement.exchangeRate)
          )
        }))
      : isRefund
        ? refundMemos.map((memo) => ({
            id: memo.id,
            totalAmount: toBaseAmount(
              Number(memo.amount),
              Number(memo.exchangeRate)
            )
          }))
        : targetIds.length
          ? await (isAR
              ? trx
                  .selectFrom("salesInvoices")
                  .select(["id", "totalAmount"])
                  .where("companyId", "=", companyId)
                  .where("id", "in", targetIds)
                  .execute()
              : trx
                  .selectFrom("purchaseInvoices")
                  .select(["id", "totalAmount"])
                  .where("companyId", "=", companyId)
                  .where("id", "in", targetIds)
                  .execute())
          : [];
    if (
      invoices.length !== targetIds.length ||
      totals.length !== targetIds.length
    )
      throw new NotFoundError(
        "Payment target invoice not found in this company"
      );
    const totalById = new Map(
      totals.map((row) => [row.id, Number(row.totalAmount)])
    );
    const priorTargetRows = targetIds.length
      ? (
          await settlementQuery(trx, companyId)
            .where((eb) =>
              isRefund
                ? eb.or([
                    eb("s.targetMemoId", "in", targetIds),
                    eb("s.memoId", "in", targetIds)
                  ])
                : eb(`s.${targetColumn}`, "in", targetIds)
            )
            .execute()
        ).filter(isEffectiveSettlement)
      : [];
    const targetControls = foldTargetControls(
      kind,
      await readTargetControlLines(trx, companyId, targetIds)
    );
    const { carryingById, controlById: targetControlById } = targetControls;
    // The reimbursement row's `payableAccountId` is checked AGAINST the booked
    // journal, never used in place of it. The map is seeded by the journal read
    // above and by nothing else — exactly as the AR/AP arms are — so the
    // missing-control guard in the targets loop below can still bite: seeding
    // it from the ROW made that guard unreachable for a reimbursement, and a
    // reimbursement POSTED with accounting disabled (no journal, so its
    // employee payable was never credited) then had its payout DEBIT that
    // liability once accounting was turned on.
    //
    // The row is still what stops the payout re-resolving the account from
    // today's `accountDefault`: a value that disagrees with the ledger means the
    // two have diverged, which must not post silently.
    for (const reimbursement of reimbursements) {
      // A Draft reimbursement has no stored payable yet — it is refused by the
      // status check in the targets loop below, which says so far more usefully
      // than "missing control account" would.
      if (reimbursement.status !== "Posted") continue;
      if (!reimbursement.payableAccountId) {
        throw new Error(
          "Reimbursement is missing its employee-payable control account"
        );
      }
      const booked = targetControlById.get(reimbursement.id);
      if (booked && booked !== reimbursement.payableAccountId) {
        throw new Error(
          "Reimbursement control account disagrees with its posted journal"
        );
      }
    }
    const targets = new Map<
      string,
      { rate: number; remainingDocument: number; remainingBase: number }
    >();
    for (const invoice of invoices) {
      if (
        invoice.partyId !== partyId ||
        invoice.currencyCode !== payment.currencyCode
      )
        throw new Error("Invoice party/currency does not match payment");
      if (
        invoice.status !==
        (isReimbursement
          ? "Posted"
          : isRefund
            ? "Posted"
            : isAR
              ? "Submitted"
              : "Open")
      ) {
        throw new Error(
          `Cannot settle invoice ${invoice.id} in status ${invoice.status}`
        );
      }
      const rate = Number(invoice.exchangeRate);
      const total = totalById.get(invoice.id)!;
      const refundMemo = refundMemos.find((memo) => memo.id === invoice.id);
      if (refundMemo && refundMemo.direction !== (isAR ? "Credit" : "Debit")) {
        throw new Error("Refund target must be a balance-reducing memo");
      }
      const used = priorTargetRows.filter(
        (row) => row.memoId === invoice.id || row.targetMemoId === invoice.id
      );
      const { remainingDocument, remainingBase } = isRefund
        ? {
            remainingDocument: toDocumentAmount(
              Number(refundMemo!.amount) -
                used.reduce(
                  (sum, row) => sum + principal(row.sourceAmount, row.id),
                  0
                ),
              1,
              decimals
            ),
            remainingBase: round(
              -(carryingById.get(invoice.id) ?? -total) -
                used.reduce((sum, row) => sum + Number(row.appliedAmount), 0)
            )
          }
        : invoiceRemainingAmounts(
            { ...invoice, totalAmount: total },
            priorTargetRows,
            carryingById,
            decimals,
            isAR,
            isReimbursement
          );
      if (remainingDocument < 0 || remainingBase < 0) {
        throw new Error("Target memo is over-applied");
      }
      // Before the cutover an invoice posted with no journal has no control
      // line; the payment then books the default control account.
      if (postingStatus === "Posted" && !targetControlById.has(invoice.id)) {
        throw new Error("Target is missing its original control account");
      }
      targets.set(invoice.id, { rate, remainingDocument, remainingBase });
    }

    const memos = memoIds.length
      ? await trx
          .selectFrom("memo")
          .selectAll()
          .where("companyId", "=", companyId)
          .where("id", "in", memoIds)
          .orderBy("id")
          .forUpdate()
          .execute()
      : [];
    if (memos.length !== memoIds.length) {
      throw new NotFoundError("Staged memo not found in this company");
    }
    const memoConsumption = memoIds.length
      ? (
          await settlementQuery(trx, companyId)
            .where((eb) =>
              eb.or([
                eb("s.memoId", "in", memoIds),
                eb("s.targetMemoId", "in", memoIds)
              ])
            )
            .execute()
        ).filter(isEffectiveSettlement)
      : [];
    const memoRemaining = new Map(
      memos.map((memo) => {
        if (
          memo.status !== "Posted" ||
          memo.currencyCode !== payment.currencyCode ||
          (isAR ? memo.customerId : memo.supplierId) !== partyId ||
          memo.direction !== (isAR ? "Credit" : "Debit")
        ) {
          throw new Error(
            "Staged memo must be posted with matching party, currency and direction"
          );
        }
        assertExchangeRate(Number(memo.exchangeRate));
        return [
          memo.id,
          {
            memo,
            document: toDocumentAmount(
              Number(memo.amount) -
                memoConsumption
                  .filter(
                    (row) =>
                      row.memoId === memo.id || row.targetMemoId === memo.id
                  )
                  .reduce(
                    (sum, row) => sum + principal(row.sourceAmount, row.id),
                    0
                  ),
              1,
              decimals
            )
          }
        ] as [string, { memo: typeof memo; document: number }];
      })
    );
    const normalizedMemos: Array<{
      id: string;
      appliedAmount: number;
      sourceAmount: number;
      sourceExchangeRate: number;
      targetExchangeRate: number;
    }> = [];
    for (const draft of drafts.filter((row) => row.memoId !== null)) {
      if (
        draft.paymentId ||
        draft.sourcePaymentId ||
        Number(draft.discountAmount) !== 0 ||
        Number(draft.writeOffAmount) !== 0
      ) {
        throw new Error(
          "Memo applications cannot carry payment funding, discounts or write-offs"
        );
      }
      const target = targets.get(draft[targetColumn]!)!;
      const source = memoRemaining.get(draft.memoId!)!;
      if (Number(source.memo.exchangeRate) !== target.rate) {
        throw new Error("Memo and invoice exchange-rate snapshots must match");
      }
      const sourceAmount =
        draft.sourceAmount === null
          ? toDocumentAmount(Number(draft.appliedAmount), target.rate, decimals)
          : principal(draft.sourceAmount, draft.id);
      if (
        toDocumentAmount(sourceAmount, 1, decimals) !== sourceAmount ||
        sourceAmount > source.document ||
        sourceAmount > target.remainingDocument
      )
        throw new Error("Staged memo principal exceeds remaining balance");
      const appliedAmount =
        sourceAmount === target.remainingDocument
          ? target.remainingBase
          : toBaseAmount(sourceAmount, target.rate);
      if (appliedAmount > target.remainingBase) {
        throw new Error("Staged memo exceeds target carrying balance");
      }
      source.document = toDocumentAmount(
        source.document - sourceAmount,
        1,
        decimals
      );
      target.remainingDocument = toDocumentAmount(
        target.remainingDocument - sourceAmount,
        1,
        decimals
      );
      target.remainingBase = round(target.remainingBase - appliedAmount);
      normalizedMemos.push({
        id: draft.id,
        appliedAmount,
        sourceAmount,
        sourceExchangeRate: target.rate,
        targetExchangeRate: target.rate
      });
    }

    // An employee holds no on-account credit: a reimbursement payout is always
    // funded by the current disbursement, never by a prior overpayment.
    const sources =
      isRefund || isReimbursement
        ? []
        : await trx
            .selectFrom("payment")
            .selectAll()
            .where("companyId", "=", companyId)
            .where("status", "=", "Posted")
            .where("paymentType", "=", isAR ? "Receipt" : "Disbursement")
            .where(isAR ? "customerId" : "supplierId", "=", partyId)
            .where("currencyCode", "=", payment.currencyCode)
            .where("id", "!=", paymentId)
            .orderBy("id")
            .forUpdate()
            .execute();
    const sourceIds = sources.map((source) => source.id);
    const sourceControls = foldSourceControls(
      kind,
      await readSourceControlLines(trx, companyId, sourceIds)
    );
    const consumed = sourceIds.length
      ? (
          await settlementQuery(trx, companyId)
            .where((eb) =>
              eb.or([
                eb("s.sourcePaymentId", "in", sourceIds),
                eb.and([
                  eb("s.sourcePaymentId", "is", null),
                  eb("s.paymentId", "in", sourceIds)
                ])
              ])
            )
            .execute()
        ).filter(isEffectiveSettlement)
      : [];
    // A customer deposit funds only invoices of its own rental agreement or
    // sales order, and a deposit payment applies to nothing else — re-derived
    // here so a crafted Draft cannot spend one document's deposit on another.
    const priorSources = remainingFundingSources(
      sources.map((source) => ({
        ...source,
        scope: isAR ? fundingScopeOf(source) : null
      })),
      consumed,
      new Map([[payment.currencyCode, decimals]]),
      isAR
    );
    const currentScope =
      isAR && !isRefund && !isReimbursement
        ? await loadDepositScope(trx, companyId, payment)
        : null;
    const invoiceDocuments =
      isAR &&
      !isRefund &&
      !isReimbursement &&
      (currentScope || priorSources.some((source) => source.scope))
        ? await loadSalesInvoiceDocumentIds(trx, companyId, targetIds)
        : new Map<string, InvoiceDocumentIds>();
    const requestByTarget = new Map<string, FundingRequest>();
    for (const draft of drafts.filter((row) => row.paymentId === paymentId)) {
      const targetId = draft[targetColumn]!;
      const target = targets.get(targetId)!;
      const requested =
        draft.sourceAmount === null
          ? Number(draft.appliedAmount) === target.remainingBase &&
            Number(draft.discountAmount) === 0 &&
            Number(draft.writeOffAmount) === 0
            ? target.remainingDocument
            : toDocumentAmount(
                Number(draft.appliedAmount),
                target.rate,
                decimals
              )
          : principal(draft.sourceAmount, draft.id);
      if (toDocumentAmount(requested, 1, decimals) !== requested) {
        throw new Error(
          "Requested principal exceeds document currency precision"
        );
      }
      const request = requestByTarget.get(targetId) ?? {
        targetId,
        targetExchangeRate: target.rate,
        remainingDocument: target.remainingDocument,
        remainingBase: target.remainingBase,
        requestedDocumentPrincipal: 0,
        discountAmount: 0,
        writeOffAmount: 0,
        ...invoiceDocuments.get(targetId)
      };
      request.requestedDocumentPrincipal = toDocumentAmount(
        request.requestedDocumentPrincipal + requested,
        1,
        decimals
      );
      request.discountAmount = round(
        request.discountAmount + Number(draft.discountAmount)
      );
      request.writeOffAmount = round(
        request.writeOffAmount + Number(draft.writeOffAmount)
      );
      requestByTarget.set(targetId, request);
    }
    const allocation = allocatePaymentFunding({
      currentPayment: {
        paymentId,
        postingDate: today,
        exchangeRate: Number(payment.exchangeRate),
        remainingDocument: Number(payment.totalAmount),
        remainingBase: toBaseAmount(
          Number(payment.totalAmount),
          Number(payment.exchangeRate)
        ),
        scope: currentScope
      },
      priorSources,
      requests: [...requestByTarget.values()].sort((a, b) =>
        a.targetId.localeCompare(b.targetId)
      ),
      currencyDecimals: decimals,
      isAR: cashIn
    });

    const defaults = await trx
      .selectFrom("accountDefault")
      .selectAll()
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!defaults) {
      throw new Error("Accounting defaults are required before posting");
    }
    const party = (await readPaymentParties(trx, companyId, [kind]))(kind);
    const normalized = allocation.applications.map((application) => ({
      ...application,
      targetSalesInvoiceId:
        !isRefund && !isReimbursement && isAR ? application.targetId : null,
      targetPurchaseInvoiceId:
        !isRefund && !isReimbursement && !isAR ? application.targetId : null,
      targetMemoId: isRefund && !isReimbursement ? application.targetId : null,
      targetReimbursementId: isReimbursement ? application.targetId : null
    }));
    const assembled = assemblePaymentJournal({
      payment,
      kind,
      companyId,
      defaults,
      control: paymentControlAccount(kind, party, defaults, postingStatus),
      discountClasses: await readDiscountAccountClasses(
        trx,
        company.companyGroupId,
        defaults
      ),
      targets: targetControls,
      sources: sourceControls,
      applications: normalized,
      newOnAccountBase: allocation.sourceRemainders[0]!.remainingBase,
      fee,
      journalLineReference: nanoid()
    });
    const { accounts } = assembled.input;
    const journalLines = assembled.lines;
    const expectedAccountClasses: Array<[string | null | undefined, string]> = [
      [payment.bankAccount, "Asset"],
      [accounts.controlAccountId, isAR ? "Asset" : "Liability"],
      [accounts.discountAccountId, isAR ? "Revenue" : "Expense"],
      [accounts.writeOffAccountId, isAR ? "Expense" : "Revenue"],
      [accounts.fxGainAccountId, "Revenue"],
      [accounts.fxLossAccountId, "Expense"],
      [fee?.accountId, "Expense"]
    ];
    if (isDeposit && isAR) {
      expectedAccountClasses.push([defaults.prepaymentAccount, "Liability"]);
    }
    for (const application of assembled.input.applications) {
      expectedAccountClasses.push(
        [application.targetControlAccountId, isAR ? "Asset" : "Liability"],
        [
          application.sourceControlAccountId,
          application.sourceIsDeposit
            ? "Liability"
            : isAR
              ? "Asset"
              : "Liability"
        ]
      );
    }
    const accountIds = [
      ...new Set([
        payment.bankAccount,
        ...journalLines.map((line) => line.accountId)
      ])
    ];
    const postingAccounts = await trx
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "in", accountIds)
      .where("companyGroupId", "=", company.companyGroupId)
      .where("active", "=", true)
      .where("isGroup", "=", false)
      .execute();
    if (
      postingAccounts.length !== accountIds.length ||
      postingAccounts.find((account) => account.id === payment.bankAccount)
        ?.class !== "Asset"
    ) {
      throw new Error(
        "Payment accounts must be active posting accounts in this company group, with an Asset bank account"
      );
    }
    const classById = new Map(
      postingAccounts.map((account) => [account.id, account.class])
    );
    // A stand-in account is not the account its role wants, so its class is
    // not checked; the enable re-points it to the default.
    const standInAccounts = new Set(
      journalLines.flatMap((line) =>
        line.accountDefaultRole ? [line.accountId] : []
      )
    );
    if (
      expectedAccountClasses.some(
        ([id, expected]) =>
          id &&
          !standInAccounts.has(id) &&
          classById.has(id) &&
          classById.get(id) !== expected
      )
    ) {
      throw new Error("Payment account class does not match its posting role");
    }
    // Replace current-cash/prior-credit splits only after all authoritative
    // validation. The entire replacement, journal and status share this transaction.
    await trx
      .deleteFrom("invoiceSettlement")
      .where("paymentId", "=", paymentId)
      .where("companyId", "=", companyId)
      .execute();
    if (normalized.length) {
      await trx
        .insertInto("invoiceSettlement")
        .values(
          normalized.map(({ targetId: _, ...application }) => ({
            ...application,
            paymentId,
            companyId,
            appliedDate: today,
            createdBy: userId
          }))
        )
        .execute();
    }
    // One set-based UPDATE preserves memo row identities and avoids query-per-row writes.
    if (normalizedMemos.length) {
      await sql`UPDATE "invoiceSettlement" s SET "appliedAmount"=v."appliedAmount", "sourceAmount"=v."sourceAmount",
        "sourceExchangeRate"=v."sourceExchangeRate", "targetExchangeRate"=v."targetExchangeRate", "fxGainLossAmount"=0, "appliedDate"=${today}::date, "updatedBy"=${userId}
        FROM jsonb_to_recordset(${JSON.stringify(
          normalizedMemos
        )}::jsonb) AS v(id text,"appliedAmount" numeric,"sourceAmount" numeric,"sourceExchangeRate" numeric,"targetExchangeRate" numeric)
        WHERE s.id=v.id AND s."companyId"=${companyId} AND s."appliedViaPaymentId"=${paymentId}`.execute(
        trx
      );
    }
    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
        accountingPeriodId,
        description: `Payment ${payment.paymentId}`,
        postingDate: today,
        companyId,
        sourceType: "Payment",
        status: postingStatus,
        postedAt: timestamp,
        postedBy: userId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const journalId = journal.id;
    if (journalLines.length) {
      const lines = await trx
        .insertInto("journalLine")
        .values(
          journalLines.map((line) => ({
            ...line,
            journalId: journal.id
          }))
        )
        .returning("id")
        .execute();
      // A reimbursement payout has no trade party to tag, and the document's
      // own journal (post-reimbursement) writes no party dimension either —
      // so the two stay symmetric rather than the payout carrying a
      // dimension the liability it clears never had.
      const dimensions = isReimbursement
        ? []
        : paymentDimensions(
            await loadPartyDimensions(trx, company.companyGroupId),
            kind,
            party
          );
      const values = dimensions.flatMap((dimension) =>
        lines.map((line) => ({
          journalLineId: line.id,
          ...dimension,
          companyId
        }))
      );
      if (values.length) {
        await trx.insertInto("journalLineDimension").values(values).execute();
      }
    }
    await trx
      .updateTable("payment")
      .set({
        status: "Posted",
        postingDate: today,
        journalId,
        postedAt: timestamp,
        postedBy: userId,
        updatedAt: timestamp,
        updatedBy: userId
      })
      .where("id", "=", paymentId)
      .where("companyId", "=", companyId)
      .execute();
    return { journalId };
  });
}
