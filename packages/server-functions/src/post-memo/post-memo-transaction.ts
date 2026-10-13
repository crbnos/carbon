// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isBeforeCutover } from "@carbon/database/accounting-cutover-dates";
import {
  DOCUMENT_JOURNAL_STATUSES,
  OPEN_ITEM_JOURNAL_STATUSES
} from "@carbon/database/accounting-posting";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  applyContractMovement,
  type ContractMovement,
  EMPTY_POSITION
} from "@carbon/database/contract-position";
import {
  postingStatusFor,
  readAccountingCutoverDate
} from "@carbon/database/journal-posting-status";
import { buildMemoJournal } from "@carbon/database/posting";
import { getNextSequence } from "@carbon/database/sequence";
import {
  datetime,
  EPSILON,
  round,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import { type Kysely, sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { NotFoundError } from "../errors";
import {
  loadContractPositions,
  lockContractPositions,
  signedCreditAmount
} from "../lib/contract-ledger";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import { partyDimensionValues } from "../lib/party-dimensions";
import type { RentalScheduleFact } from "../post-sales-invoice/rental-posting";
import {
  plainMemoReasonAccount,
  supplierReturnCarriedCost,
  withReasonRole
} from "./memo-accounts";
import { rebuildMemoJournal } from "./rebuild-journal";
import { planRentalCredit, type RentalCreditPlan } from "./rental-credit";

export type PostMemoArgs = {
  type: "post" | "void";
  memoId: string;
  companyId: string;
  userId: string;
  today: string;
};

/** The endpoint's commit boundary. Headers, defaults and account classes come from this transaction. */
export function postMemoTransaction(
  db: Kysely<KyselyDatabase>,
  args: PostMemoArgs
): Promise<{ journalId: string | null }> {
  const { type, memoId, companyId, userId, today } = args;
  return db.transaction().execute(async (trx) => {
    const memo = await trx
      .selectFrom("memo")
      .selectAll()
      .where("id", "=", memoId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!memo) throw new NotFoundError("Memo not found");
    if (type === "post" && memo.status === "Posted") {
      return { journalId: memo.journalId };
    }
    if (type === "void" && memo.status === "Voided") {
      return { journalId: memo.journalId };
    }
    if (memo.status !== (type === "post" ? "Draft" : "Posted")) {
      throw new Error(`Cannot ${type} memo in status ${memo.status}`);
    }
    // Every memo posts a journal: Provisional before the company's accounting
    // cutover, Posted after it. FOR SHARE holds the cutover until commit. A
    // Provisional journal has no accounting period.
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
      const period = await trx
        .selectFrom("accountingPeriod")
        .select(["id", "closeStatus", "closedAt"])
        .where("id", "=", accountingPeriodId)
        .where("companyId", "=", companyId)
        .forShare()
        .executeTakeFirst();
      if (
        !period ||
        period.closeStatus === "Locked" ||
        period.closeStatus === "Closed" ||
        period.closedAt
      )
        throw new Error("Accounting period is closed or locked");
    }
    if (type === "void") {
      // Posting a consuming payment takes this same memo lock. A void cannot
      // erase its source while that payment still carries the application.
      const consumption = await trx
        .selectFrom("invoiceSettlement as s")
        .leftJoin("payment as applying", (join) =>
          join
            .onRef("applying.id", "=", "s.appliedViaPaymentId")
            .onRef("applying.companyId", "=", "s.companyId")
        )
        .leftJoin("payment as refund", (join) =>
          join
            .onRef("refund.id", "=", "s.paymentId")
            .onRef("refund.companyId", "=", "s.companyId")
        )
        .select("s.id")
        .where("s.companyId", "=", companyId)
        .where((eb) =>
          eb.or([
            eb.and([
              eb("s.memoId", "=", memoId),
              eb.or([
                eb("s.appliedViaPaymentId", "is", null),
                eb("applying.status", "=", "Posted")
              ])
            ]),
            eb.and([
              eb("s.targetMemoId", "=", memoId),
              eb("refund.status", "=", "Posted")
            ])
          ])
        )
        .limit(1)
        .executeTakeFirst();
      if (consumption) {
        throw new Error(
          "Cannot void a consumed memo; void its applying payment or remove its direct application first"
        );
      }
      let journalId: string | null = null;
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
              description: `VOID Memo ${memo.memoId}`,
              postingDate: today,
              companyId,
              sourceType:
                memo.direction === "Credit" ? "Credit Memo" : "Debit Memo",
              status: postingStatus,
              postedAt: timestamp,
              postedBy: userId,
              createdBy: userId
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      // Before the cutover the memo's own journal is Superseded, and the
      // opening journal carries the memo's open amount. The void builds the
      // memo's posting again and negates it, today, so it nets that line.
      if (memo.postingDate && isBeforeCutover(memo.postingDate, cutoverDate)) {
        const rebuilt = await rebuildMemoJournal(trx, memo, postingStatus);
        const reversedId = await insertVoidJournal();
        journalId = reversedId;
        const lines = await trx
          .insertInto("journalLine")
          .values(
            rebuilt.lines.map((line) => ({
              journalId: reversedId,
              accountId: line.accountId,
              amount: -line.amount,
              quantity: line.quantity,
              description: `VOID: ${line.description}`,
              documentType: "Memo" as const,
              documentId: memoId,
              journalLineReference: line.journalLineReference,
              accountDefaultRole: line.accountDefaultRole,
              companyId
            }))
          )
          .returning("id")
          .execute();
        const dimensionValues = rebuilt.dimensions.flatMap((dimension) =>
          lines.map((line) => ({
            journalLineId: line.id,
            ...dimension,
            companyId
          }))
        );
        if (dimensionValues.length) {
          await trx
            .insertInto("journalLineDimension")
            .values(dimensionValues)
            .execute();
        }
      } else if (memo.journalId) {
        const originalJournal = await trx
          .selectFrom("journal")
          .select(["id", "status", "sourceType"])
          .where("id", "=", memo.journalId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (
          !originalJournal ||
          !(OPEN_ITEM_JOURNAL_STATUSES as readonly string[]).includes(
            originalJournal.status
          ) ||
          originalJournal.sourceType !==
            (memo.direction === "Credit" ? "Credit Memo" : "Debit Memo")
        )
          throw new NotFoundError(
            "Original memo journal not found in this company"
          );
        const original = await trx
          .selectFrom("journalLine")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "journalLine.journalId")
              .onRef("journal.companyId", "=", "journalLine.companyId")
          )
          .selectAll("journalLine")
          .where("journalLine.journalId", "=", memo.journalId)
          .where("journalLine.companyId", "=", companyId)
          .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
          .orderBy("journalLine.id")
          .execute();
        if (!original.length) {
          throw new Error("Original memo journal has no lines to reverse");
        }
        const reversedId = await insertVoidJournal();
        journalId = reversedId;
        const lines = await trx
          .insertInto("journalLine")
          .values(
            original.map((line) => ({
              journalId: reversedId,
              accountId: line.accountId,
              amount: -Number(line.amount),
              quantity: line.quantity,
              description: `VOID: ${line.description ?? ""}`,
              documentType: "Memo" as const,
              documentId: memoId,
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
        const reverseByOriginal = new Map(
          original.map((line, index) => [line.id, lines[index]!.id])
        );
        if (dimensions.length) {
          await trx
            .insertInto("journalLineDimension")
            .values(
              dimensions.map((d) => ({
                ...d,
                journalLineId: reverseByOriginal.get(d.journalLineId)!,
                companyId
              }))
            )
            .execute();
        }
      }
      // A rental early-return credit gives its periods back: its Planned
      // Deferral rows go (index.ts refused the void if any had posted or a
      // Draft run held one) and the adjustments return to Pending, so the
      // next invoice run credits them on a new memo.
      if (memo.rentalAgreementId) {
        await trx
          .deleteFrom("revenueRecognitionSchedule")
          .where("companyId", "=", companyId)
          .where("memoId", "=", memoId)
          .where("status", "=", "Planned")
          .where("runLineId", "is", null)
          .execute();
        await trx
          .updateTable("rentalBillingPeriod")
          .set({
            status: "Pending",
            memoId: null,
            updatedBy: userId,
            updatedAt: timestamp
          })
          .where("companyId", "=", companyId)
          .where("memoId", "=", memoId)
          .execute();
      }
      await trx
        .updateTable("memo")
        .set({
          status: "Voided",
          voidedAt: timestamp,
          voidedBy: userId,
          updatedAt: timestamp,
          updatedBy: userId
        })
        .where("id", "=", memoId)
        .where("companyId", "=", companyId)
        .execute();
      return { journalId };
    }

    if (Boolean(memo.customerId) === Boolean(memo.supplierId)) {
      throw new Error("Memo must have exactly one customer or supplier");
    }
    const isAR = Boolean(memo.customerId);
    const partyId = (isAR ? memo.customerId : memo.supplierId)!;
    const company = await trx
      .selectFrom("company")
      .select(["companyGroupId", "baseCurrencyCode"])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!company?.companyGroupId || !memo.currencyCode) {
      throw new Error("Memo currency configuration is missing");
    }
    const currency = await trx
      .selectFrom("currency")
      .select("decimalPlaces")
      .where("companyGroupId", "=", company.companyGroupId)
      .where("code", "=", memo.currencyCode)
      .executeTakeFirst();
    if (!currency || currency.decimalPlaces == null) {
      throw new Error("Memo currency decimal places are not configured");
    }
    const amount = Number(memo.amount);
    const exchangeRate = Number(memo.exchangeRate);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Memo amount must be positive and finite");
    }
    toBaseAmount(amount, exchangeRate);
    if (toDocumentAmount(amount, 1, currency.decimalPlaces) !== amount) {
      throw new Error("Memo amount exceeds document currency precision");
    }
    if (company.baseCurrencyCode === memo.currencyCode && exchangeRate !== 1) {
      throw new Error("Base-currency memo must use exchange rate 1");
    }
    const party = isAR
      ? await trx
          .selectFrom("customer")
          .select(["customerTypeId as typeId", "intercompanyCompanyId"])
          .where("id", "=", partyId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : await trx
          .selectFrom("supplier")
          .select(["supplierTypeId as typeId", "intercompanyCompanyId"])
          .where("id", "=", partyId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
    if (!party)
      throw new NotFoundError("Memo counterparty not found in this company");
    const defaults = await trx
      .selectFrom("accountDefault")
      .selectAll()
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!defaults) {
      throw new Error("Accounting defaults are required before posting");
    }
    const controlAccountId = isAR
      ? defaults.receivablesAccount
      : defaults.payablesAccount;
    // Return-order memos override the reason (offset) account. A customer-RMA
    // credit memo books to contra-revenue (salesReturnsAccount, fallback
    // salesAccount); a supplier-return DEBIT memo nets GRNI against payables —
    // its shipment already DEBITED GRNI at carried cost, so the memo's reason
    // leg credits GRNI back to zero while the control leg reduces AP. Every
    // other memo keeps the deterministic-by-party offset.
    //
    // A contract cancellation credit lowers each credited line's position
    // (plan D7): it debits Deferred Revenue up to the line's deferred pool
    // and Contract Assets for the rest, so the cancelled months are never
    // recognized afterwards and anything already recognized becomes an
    // asset the next run clears against the cancellation's catch-up rows.
    const contractCredit =
      memo.customerContractId && isAR && memo.direction === "Credit"
        ? await planContractCredit(trx, {
            memoId,
            companyId,
            customerContractId: memo.customerContractId,
            amount,
            exchangeRate
          })
        : null;
    // A rental early-return credit books what the negative Rent invoice line
    // did: the unearned part off Deferred Revenue (shrinking the period's
    // Planned rows), anything already recognized off Rental Income.
    const rentalCredit =
      memo.rentalAgreementId && isAR && memo.direction === "Credit"
        ? await loadRentalCredit(trx, {
            memoId,
            companyId,
            rentalAgreementId: memo.rentalAgreementId,
            amount,
            decimals: currency.decimalPlaces
          })
        : null;
    const rentalAccountIds = {
      deferredRevenue: defaults.deferredRevenueAccount,
      rentalIncome: defaults.rentalIncomeAccount
    };
    const contractAccountIds = contractCredit
      ? {
          deferredRevenue: defaults.deferredRevenueAccount,
          contractAsset: defaults.contractAssetAccount,
          sales: defaults.salesAccount,
          fxGain: defaults.realizedExchangeGainAccount,
          fxLoss: defaults.realizedExchangeLossAccount
        }
      : null;
    const plainReason =
      contractCredit || rentalCredit
        ? null
        : plainMemoReasonAccount(memo, defaults, isAR, postingStatus);
    const reasonAccountDefaultRole = plainReason?.accountDefaultRole ?? null;
    const reasonAccountId = plainReason
      ? plainReason.accountId
      : defaults.deferredRevenueAccount;
    if (!controlAccountId || !reasonAccountId) {
      throw new Error("Memo control and reason account defaults are required");
    }
    // The legs replacing the reason leg of a contract or rental credit,
    // each account required only when its leg posts.
    const contractLegs = contractCredit
      ? contractCreditLegs(contractCredit, contractAccountIds!)
      : rentalCredit
        ? rentalCredit.legs.map((leg) => ({
            ...leg,
            accountId: rentalAccountIds[leg.account]
          }))
        : [];
    for (const leg of contractLegs) {
      if (!leg.accountId) {
        throw new Error(
          `${rentalCredit ? "Rental" : "Contract"} credit memos need the ${leg.description} account mapped in the accounting defaults`
        );
      }
    }
    const accountIds = [
      ...new Set(
        [
          controlAccountId,
          reasonAccountId,
          ...contractLegs.map((leg) => leg.accountId)
        ].filter((id): id is string => !!id)
      )
    ];
    const accounts = await trx
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "in", accountIds)
      .where("companyGroupId", "=", company.companyGroupId)
      .where("active", "=", true)
      .where("isGroup", "=", false)
      .execute();
    const control = accounts.find((a) => a.id === controlAccountId);
    const reason = accounts.find((a) => a.id === reasonAccountId);
    if (
      accounts.length !== accountIds.length ||
      control?.class !== (isAR ? "Asset" : "Liability") ||
      !reason?.class ||
      contractLegs.some(
        (leg) =>
          accounts.find((a) => a.id === leg.accountId)?.class !==
          leg.accountClass
      )
    ) {
      throw new Error(
        "Memo accounts must be active posting accounts in this company group with the correct control class"
      );
    }
    const reasonAmountBase = await supplierReturnCarriedCost(trx, memo);

    const { lines } = buildMemoJournal({
      memoId,
      companyId,
      isAR,
      direction: memo.direction,
      amount,
      exchangeRate,
      journalLineReference: nanoid(),
      controlAccountId,
      reasonAccountId,
      reasonAccountClass: reason.class,
      reasonAmountBase,
      varianceAccountId: defaults.purchaseVarianceAccount,
      reasonDescription: memo.purchaseReturnOrderId
        ? "Goods Received Not Invoiced"
        : contractCredit || rentalCredit
          ? "Deferred Revenue"
          : undefined
    });
    if (contractCredit || rentalCredit) {
      // The builder books one reason leg (index 1, after the control leg).
      // Replace it with the contract legs; they add up to it exactly (the
      // FX leg is the remainder), so the entry still balances.
      const reasonLine = lines[1]!;
      lines.splice(
        1,
        1,
        ...contractLegs.map((leg) => ({
          ...reasonLine,
          accountId: leg.accountId!,
          description: leg.description,
          amount: signedCreditAmount(leg.accountClass, leg.credit)
        }))
      );
    }
    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
        accountingPeriodId,
        description: `${memo.direction} Memo ${memo.memoId}`,
        postingDate: today,
        companyId,
        sourceType: memo.direction === "Credit" ? "Credit Memo" : "Debit Memo",
        status: postingStatus,
        postedAt: timestamp,
        postedBy: userId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const journalId = journal.id;
    const inserted = await trx
      .insertInto("journalLine")
      .values(
        withReasonRole(lines, reasonAccountId, reasonAccountDefaultRole).map(
          (line) => ({ ...line, journalId: journal.id })
        )
      )
      .returning("id")
      .execute();
    if (rentalCredit && rentalCredit.scheduleRows.length > 0) {
      await trx
        .insertInto("revenueRecognitionSchedule")
        .values(
          rentalCredit.scheduleRows.map((row) => ({
            type: "Deferral" as const,
            status: "Planned" as const,
            memoId,
            rentalAgreementLineId: row.rentalAgreementLineId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            scheduledDate: row.scheduledDate,
            amount: row.amount,
            debitAccountId: rentalAccountIds.deferredRevenue!,
            creditAccountId: rentalAccountIds.rentalIncome!,
            companyId,
            createdBy: userId
          }))
        )
        .execute();
    }
    if (contractCredit && contractCredit.lines.length > 0) {
      await trx
        .insertInto("customerContractLedgerEntry")
        .values(
          contractCredit.lines.map(({ lineId, movement }) => ({
            customerContractId: memo.customerContractId!,
            customerContractLineId: lineId,
            entryType: "Credit Memo" as const,
            postingDate: today,
            memoId,
            journalId: journal.id,
            deferredAmount: movement.deferredAmount,
            deferredBase: movement.deferredBase,
            assetAmount: movement.assetAmount,
            assetBase: movement.assetBase,
            companyId,
            createdBy: userId
          }))
        )
        .execute();
    }
    const dimensions = await partyDimensionValues(trx, {
      companyGroupId: company.companyGroupId,
      isAR,
      partyId,
      typeId: party.typeId
    });
    const dimensionValues = dimensions.flatMap((dimension) =>
      inserted.map((line) => ({
        journalLineId: line.id,
        ...dimension,
        companyId
      }))
    );
    if (dimensionValues.length) {
      await trx
        .insertInto("journalLineDimension")
        .values(dimensionValues)
        .execute();
    }
    await trx
      .updateTable("memo")
      .set({
        status: "Posted",
        postingDate: today,
        journalId,
        // A stand-in is not the memo's reason account; the enable re-points
        // the line, and the memo keeps none, as before the cutover.
        reasonAccount: reasonAccountDefaultRole ? null : reasonAccountId,
        postedAt: timestamp,
        postedBy: userId,
        updatedAt: timestamp,
        updatedBy: userId
      })
      .where("id", "=", memoId)
      .where("companyId", "=", companyId)
      .execute();
    return { journalId };
  });
}

type ContractCredit = {
  /** One movement per credited contract line. */
  lines: { lineId: string; movement: ContractMovement }[];
  /** The memo in base: what the AR leg credits. */
  memoBase: number;
  /** The part of the memo no credited line covers, in base (debits Sales). */
  uncoveredBase: number;
};

/**
 * What a contract cancellation credit does to each line it credits: the
 * memo-borne adjustment rows (`customerContractInvoiceLine.memoId`), summed
 * per line, applied to the line's position as a reducing movement at the
 * memo's rate against the receivable. Takes the position lock; the ledger
 * entries are written with the journal.
 */
async function planContractCredit(
  trx: Transaction<KyselyDatabase>,
  args: {
    memoId: string;
    companyId: string;
    customerContractId: string;
    amount: number;
    exchangeRate: number;
  }
): Promise<ContractCredit> {
  const { memoId, companyId, customerContractId, amount, exchangeRate } = args;
  await lockContractPositions(trx, companyId);
  const credited = await trx
    .selectFrom("customerContractInvoiceLine")
    .select(["customerContractLineId", "amount"])
    .where("companyId", "=", companyId)
    .where("customerContractId", "=", customerContractId)
    .where("memoId", "=", memoId)
    .orderBy("customerContractLineId")
    .orderBy("id")
    .execute();
  const byLine = new Map<string, number>();
  for (const row of credited) {
    byLine.set(
      row.customerContractLineId,
      (byLine.get(row.customerContractLineId) ?? 0) + Number(row.amount)
    );
  }
  const positions = await loadContractPositions(trx, companyId, [
    ...byLine.keys()
  ]);
  const lines: ContractCredit["lines"] = [];
  let covered = 0;
  for (const [lineId, sum] of byLine) {
    const lineAmount = round(sum);
    if (lineAmount === 0) continue;
    covered = round(covered - lineAmount);
    lines.push({
      lineId,
      movement: applyContractMovement({
        position: positions.get(lineId) ?? EMPTY_POSITION,
        amount: lineAmount,
        rate: exchangeRate,
        counterpart: "receivable"
      })
    });
  }
  const uncovered = round(amount - covered);
  if (uncovered < -EPSILON) {
    throw new Error(
      "The contract lines this memo credits add up to more than the memo amount"
    );
  }
  return {
    lines,
    memoBase: toBaseAmount(amount, exchangeRate),
    uncoveredBase:
      uncovered > EPSILON ? toBaseAmount(uncovered, exchangeRate) : 0
  };
}

/** The journal legs replacing a contract credit memo's reason leg, as signed
 *  credits (negative = debit): Deferred Revenue and Contract Assets by the
 *  pools' base deltas, Sales for any part no line covers, and the realized
 *  FX that makes them sum to the AR credit. Zero legs are dropped. */
function contractCreditLegs(
  credit: ContractCredit,
  accounts: {
    deferredRevenue: string | null;
    contractAsset: string | null;
    sales: string | null;
    fxGain: string | null;
    fxLoss: string | null;
  }
): {
  accountId: string | null;
  accountClass: "Liability" | "Asset" | "Revenue" | "Expense";
  description: string;
  credit: number;
}[] {
  const deferred = round(
    credit.lines.reduce((sum, { movement }) => sum + movement.deferredBase, 0)
  );
  const asset = round(
    -credit.lines.reduce((sum, { movement }) => sum + movement.assetBase, 0)
  );
  const sales = -credit.uncoveredBase;
  // The revenue side must debit exactly what AR credits.
  const fx = round(-credit.memoBase - deferred - asset - sales);
  return [
    {
      accountId: accounts.deferredRevenue,
      accountClass: "Liability" as const,
      description: "Deferred Revenue",
      credit: deferred
    },
    {
      accountId: accounts.contractAsset,
      accountClass: "Asset" as const,
      description: "Contract Assets",
      credit: asset
    },
    {
      accountId: accounts.sales,
      accountClass: "Revenue" as const,
      description: "Sales",
      credit: sales
    },
    fx > 0
      ? {
          accountId: accounts.fxGain,
          accountClass: "Revenue" as const,
          description: "Realized FX gain",
          credit: fx
        }
      : {
          accountId: accounts.fxLoss,
          accountClass: "Expense" as const,
          description: "Realized FX loss",
          credit: fx
        }
  ].filter((leg) => leg.credit !== 0);
}

/**
 * Loads what a rental early-return credit memo credits — its adjustment
 * periods (`rentalBillingPeriod.memoId`) and the Planned Deferral rows of
 * their agreement lines — and plans the posting (`planRentalCredit`). The
 * periods are locked: a concurrent void or delete of the same memo waits.
 */
async function loadRentalCredit(
  trx: Transaction<KyselyDatabase>,
  args: {
    memoId: string;
    companyId: string;
    rentalAgreementId: string;
    amount: number;
    decimals: number;
  }
): Promise<RentalCreditPlan> {
  const { memoId, companyId, rentalAgreementId } = args;
  const periods = await trx
    .selectFrom("rentalBillingPeriod as p")
    .innerJoin("rentalAgreementLine as l", (join) =>
      join
        .onRef("l.id", "=", "p.rentalAgreementLineId")
        .onRef("l.companyId", "=", "p.companyId")
    )
    .select([
      "p.id",
      "p.rentalAgreementLineId",
      sql<string>`p."periodStart"::text`.as("periodStart"),
      sql<string>`p."periodEnd"::text`.as("periodEnd"),
      "p.amount",
      "l.lessorClassification",
      "l.rentalAgreementId"
    ])
    .where("p.companyId", "=", companyId)
    .where("p.memoId", "=", memoId)
    .orderBy("p.periodStart")
    .orderBy("p.id")
    .forUpdate("p")
    .execute();
  if (
    periods.some((period) => period.rentalAgreementId !== rentalAgreementId)
  ) {
    throw new Error(
      "This credit memo credits periods of another rental agreement"
    );
  }
  const lineIds = [...new Set(periods.map((p) => p.rentalAgreementLineId))];
  const deferralRows =
    lineIds.length === 0
      ? []
      : await trx
          .selectFrom("revenueRecognitionSchedule")
          .select([
            "id",
            "rentalAgreementLineId",
            sql<string>`"periodStart"::text`.as("periodStart"),
            sql<string>`"periodEnd"::text`.as("periodEnd"),
            sql<string>`"scheduledDate"::text`.as("scheduledDate"),
            "amount"
          ])
          .where("companyId", "=", companyId)
          .where("rentalAgreementLineId", "in", lineIds)
          .where("type", "=", "Deferral")
          .where("status", "=", "Planned")
          .orderBy("id")
          .execute();
  const plannedDeferrals = new Map<string, RentalScheduleFact[]>();
  for (const row of deferralRows) {
    if (!row.rentalAgreementLineId) continue;
    const facts = plannedDeferrals.get(row.rentalAgreementLineId) ?? [];
    facts.push({
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      scheduledDate: row.scheduledDate,
      amount: Number(row.amount)
    });
    plannedDeferrals.set(row.rentalAgreementLineId, facts);
  }
  return planRentalCredit({
    memoAmount: args.amount,
    decimals: args.decimals,
    periods: periods.map((period) => ({
      id: period.id,
      rentalAgreementLineId: period.rentalAgreementLineId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      amount: Number(period.amount),
      classification: period.lessorClassification
    })),
    plannedDeferrals,
    rentalAgreementId
  });
}
