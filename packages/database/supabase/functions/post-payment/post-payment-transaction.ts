import type { Kysely, Transaction } from "kysely";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DB } from "../lib/database.ts";
import type { Database } from "../lib/types.ts";
import {
  buildPaymentJournal,
  type PaymentJournalFeeInput,
} from "./build-payment-journal.ts";
import { datetime } from "../lib/datetime.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import {
  allocatePaymentFunding,
  type FundingRequest,
  type FundingSource,
} from "../shared/payment-funding.ts";
import {
  toBaseAmount,
  toDocumentAmount,
} from "../shared/accounting-currency.ts";
import { round } from "../shared/precision.ts";

export type PostPaymentArgs = {
  type: "post" | "void";
  paymentId: string;
  companyId: string;
  userId: string;
  today: string;
  client: SupabaseClient<Database>;
  fee?: PaymentJournalFeeInput;
};

function settlementQuery(trx: Transaction<DB>, companyId: string) {
  return trx.selectFrom("invoiceSettlement as s")
    .leftJoin(
      "payment as p",
      (join) =>
        join.onRef("p.id", "=", "s.paymentId").onRef(
          "p.companyId",
          "=",
          "s.companyId",
        ),
    )
    .leftJoin(
      "memo as m",
      (join) =>
        join.onRef("m.id", "=", "s.memoId").onRef(
          "m.companyId",
          "=",
          "s.companyId",
        ),
    )
    .leftJoin(
      "payment as vp",
      (join) =>
        join.onRef("vp.id", "=", "s.appliedViaPaymentId").onRef(
          "vp.companyId",
          "=",
          "s.companyId",
        ),
    )
    .selectAll("s").select([
      "p.status as paymentStatus",
      "m.status as memoStatus",
      "vp.status as viaStatus",
    ])
    .where("s.companyId", "=", companyId);
}

function effective(
  row: {
    paymentId: string | null;
    memoId: string | null;
    appliedViaPaymentId: string | null;
    paymentStatus: string | null;
    memoStatus: string | null;
    viaStatus: string | null;
  },
) {
  return row.paymentId
    ? row.paymentStatus === "Posted"
    : row.memoId && row.memoStatus === "Posted" &&
      (!row.appliedViaPaymentId || row.viaStatus === "Posted");
}

function principal(value: number | null, label: string): number {
  if (value === null || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`Missing or invalid source principal for ${label}`);
  }
  return Number(value);
}

/** The endpoint's single commit boundary; every monetary snapshot is read under locks. */
export function postPaymentTransaction(
  db: Kysely<DB>,
  args: PostPaymentArgs,
): Promise<{ journalId: string | null }> {
  const { companyId, paymentId, userId, today, client, fee, type } = args;
  return db.transaction().execute(async (trx) => {
    const payment = await trx.selectFrom("payment").selectAll()
      .where("id", "=", paymentId).where("companyId", "=", companyId)
      .forUpdate().executeTakeFirst();
    if (!payment) throw new Error("Payment not found");
    if (type === "post" && payment.status === "Posted") {
      return { journalId: payment.journalId };
    }
    if (type === "void" && payment.status === "Voided") {
      return { journalId: payment.journalId };
    }
    if (payment.status !== (type === "post" ? "Draft" : "Posted")) {
      throw new Error(`Cannot ${type} payment in status ${payment.status}`);
    }

    const settings = await trx.selectFrom("companySettings").select(
      "accountingEnabled",
    ).where("id", "=", companyId).executeTakeFirst();
    const accountingEnabled = settings?.accountingEnabled === true;
    const timestamp = datetime.timestamp();
    let accountingPeriodId: string | null = null;
    if (accountingEnabled) {
      accountingPeriodId = await getCurrentAccountingPeriod(
        client,
        companyId,
        trx,
        today,
      );
      // The reader also checks period status, but the row lock protects the
      // posting against a concurrent close/lock after that read.
      const period = await trx.selectFrom("accountingPeriod").select([
        "id",
        "closeStatus",
      ])
        .where("id", "=", accountingPeriodId).where("companyId", "=", companyId)
        .forShare().executeTakeFirst();
      if (
        !period || period.closeStatus === "Closed" ||
        period.closeStatus === "Locked"
      ) throw new Error("Accounting period is closed or locked");
    }

    if (type === "void") {
      const consumers = await settlementQuery(trx, companyId).where(
        "s.sourcePaymentId",
        "=",
        paymentId,
      ).execute();
      if (
        consumers.some((row) =>
          effective(row) && principal(row.sourceAmount, row.id) > 0
        )
      ) {
        throw new Error(
          "Cannot void a funding source while posted payments consume its credit",
        );
      }
      let reversalId: string | null = null;
      if (payment.journalId) {
        if (!accountingPeriodId) {
          throw new Error(
            "Enable accounting before reversing a posted payment journal",
          );
        }
        const original = await trx.selectFrom("journalLine").selectAll().where(
          "journalId",
          "=",
          payment.journalId,
        ).where("companyId", "=", companyId).orderBy("id").execute();
        if (original.length) {
          const reversed = await trx.insertInto("journal").values({
            journalEntryId: await getNextSequence(
              trx,
              "journalEntry",
              companyId,
            ),
            accountingPeriodId,
            description: `VOID Payment ${payment.paymentId}`,
            postingDate: today,
            companyId,
            sourceType: "Payment",
            status: "Posted",
            postedAt: timestamp,
            postedBy: userId,
            createdBy: userId,
          }).returning("id").executeTakeFirstOrThrow();
          reversalId = reversed.id;
          const lines = await trx.insertInto("journalLine").values(
            original.map((line) => ({
              journalId: reversed.id,
              accountId: line.accountId,
              amount: -Number(line.amount),
              quantity: line.quantity,
              description: `VOID: ${line.description ?? ""}`,
              documentType: "Payment" as const,
              documentId: paymentId,
              documentLineReference: line.documentLineReference,
              journalLineReference: line.journalLineReference,
              companyId,
            })),
          ).returning("id").execute();
          const dimensions = await trx.selectFrom("journalLineDimension")
            .select(["journalLineId", "dimensionId", "valueId"])
            .where("companyId", "=", companyId).where(
              "journalLineId",
              "in",
              original.map((line) => line.id),
            ).execute();
          const reverseIdByOriginal = new Map(
            original.map((line, index) => [line.id, lines[index].id]),
          );
          if (dimensions.length) {
            await trx.insertInto("journalLineDimension").values(
              dimensions.map((dimension) => ({
                ...dimension,
                journalLineId: reverseIdByOriginal.get(
                  dimension.journalLineId,
                )!,
                companyId,
              })),
            ).execute();
          }
        }
      }
      await trx.updateTable("payment").set({
        status: "Voided",
        voidedAt: timestamp,
        voidedBy: userId,
        updatedAt: timestamp,
        updatedBy: userId,
      })
        .where("id", "=", paymentId).where("companyId", "=", companyId)
        .execute();
      return { journalId: reversalId };
    }

    const isAR = payment.customerId !== null;
    const partyId = isAR ? payment.customerId : payment.supplierId;
    if (
      !partyId || Boolean(payment.customerId) === Boolean(payment.supplierId)
    ) throw new Error("Payment must have exactly one customer or supplier");
    const cashIn = payment.paymentType === "Receipt";
    if (cashIn !== isAR) {
      throw new Error("Refund funding is unsupported for invoice applications");
    }
    toBaseAmount(0, Number(payment.exchangeRate));
    const company = await trx.selectFrom("company").select([
      "companyGroupId",
      "baseCurrencyCode",
    ]).where("id", "=", companyId).executeTakeFirstOrThrow();
    if (!company.companyGroupId || !payment.currencyCode) {
      throw new Error("Payment currency configuration is missing");
    }
    const currency = await trx.selectFrom("currency").select("decimalPlaces")
      .where("code", "=", payment.currencyCode).where(
        "companyGroupId",
        "=",
        company.companyGroupId,
      ).executeTakeFirst();
    if (!currency || currency.decimalPlaces === null) {
      throw new Error("Payment currency decimal places are not configured");
    }
    const decimals = currency.decimalPlaces;
    toDocumentAmount(0, 1, decimals);
    if (
      company.baseCurrencyCode === payment.currencyCode &&
      Number(payment.exchangeRate) !== 1
    ) throw new Error("Base-currency payment must use exchange rate 1");

    const drafts = await trx.selectFrom("invoiceSettlement").selectAll().where(
      "companyId",
      "=",
      companyId,
    )
      .where((eb) =>
        eb.or([
          eb("paymentId", "=", paymentId),
          eb("appliedViaPaymentId", "=", paymentId),
        ])
      ).orderBy("id").execute();
    const targetColumn = isAR
      ? "targetSalesInvoiceId"
      : "targetPurchaseInvoiceId";
    for (const draft of drafts) {
      if (
        !draft[targetColumn] || draft.targetMemoId ||
        (isAR ? draft.targetPurchaseInvoiceId : draft.targetSalesInvoiceId)
      ) throw new Error("Unsupported payment settlement target");
    }
    const targetIds = [...new Set(drafts.map((draft) => draft[targetColumn]!))]
      .sort();
    const memoIds = [
      ...new Set(drafts.flatMap((draft) => draft.memoId ? [draft.memoId] : [])),
    ].sort();
    const invoices = targetIds.length
      ? await (isAR
        ? trx.selectFrom("salesInvoice").select([
          "id",
          "customerId as partyId",
          "status",
          "currencyCode",
          "exchangeRate",
        ]).where("companyId", "=", companyId).where("id", "in", targetIds)
          .orderBy("id").forUpdate().execute()
        : trx.selectFrom("purchaseInvoice").select([
          "id",
          "supplierId as partyId",
          "status",
          "currencyCode",
          "exchangeRate",
        ]).where("companyId", "=", companyId).where("id", "in", targetIds)
          .orderBy("id").forUpdate().execute())
      : [];
    const totals = targetIds.length
      ? await (isAR
        ? trx.selectFrom("salesInvoices").select(["id", "totalAmount"]).where(
          "companyId",
          "=",
          companyId,
        ).where("id", "in", targetIds).execute()
        : trx.selectFrom("purchaseInvoices").select(["id", "totalAmount"])
          .where("companyId", "=", companyId).where("id", "in", targetIds)
          .execute())
      : [];
    if (
      invoices.length !== targetIds.length || totals.length !== targetIds.length
    ) throw new Error("Payment target invoice not found in this company");
    const totalById = new Map(
      totals.map((row) => [row.id, Number(row.totalAmount)]),
    );
    const priorTargetRows = targetIds.length
      ? (await settlementQuery(trx, companyId).where(
        `s.${targetColumn}`,
        "in",
        targetIds,
      ).execute()).filter(effective)
      : [];
    const controls = targetIds.length
      ? await trx.selectFrom("journalLine as line")
        .innerJoin(
          "journal as journal",
          (join) =>
            join.onRef("journal.id", "=", "line.journalId").onRef(
              "journal.companyId",
              "=",
              "line.companyId",
            ),
        )
        .select(["line.documentId", "line.amount"]).where(
          "line.companyId",
          "=",
          companyId,
        ).where("line.documentType", "=", "Invoice")
        .where("line.documentId", "in", targetIds).where(
          "line.description",
          "=",
          isAR ? "Accounts Receivable" : "Accounts Payable",
        )
        .where(
          "journal.sourceType",
          "=",
          isAR ? "Sales Invoice" : "Purchase Invoice",
        ).where("journal.status", "=", "Posted").execute()
      : [];
    const carryingById = new Map<string, number>();
    for (const line of controls) {
      if (line.documentId) {
        carryingById.set(
          line.documentId,
          round(
            (carryingById.get(line.documentId) ?? 0) +
              Math.abs(Number(line.amount)),
          ),
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
      ) throw new Error("Invoice party/currency does not match payment");
      if (invoice.status !== (isAR ? "Submitted" : "Open")) {
        throw new Error(
          `Cannot settle invoice ${invoice.id} in status ${invoice.status}`,
        );
      }
      const rate = Number(invoice.exchangeRate);
      const total = totalById.get(invoice.id)!;
      let remainingDocument = toDocumentAmount(total, rate, decimals);
      let remainingBase = carryingById.get(invoice.id) ??
        toBaseAmount(total, 1);
      for (const row of priorTargetRows) {
        if (row[targetColumn] === invoice.id) {
          remainingDocument = toDocumentAmount(
            remainingDocument - principal(row.sourceAmount, row.id) -
              toDocumentAmount(
                Number(row.discountAmount) + Number(row.writeOffAmount),
                rate,
                decimals,
              ),
            1,
            decimals,
          );
          remainingBase = round(
            remainingBase - Number(row.appliedAmount) -
              Number(row.discountAmount) - Number(row.writeOffAmount),
          );
        }
      }
      if (remainingDocument < 0 || remainingBase < 0) {
        throw new Error("Invoice already has excessive settlements");
      }
      targets.set(invoice.id, { rate, remainingDocument, remainingBase });
    }

    const memos = memoIds.length
      ? await trx.selectFrom("memo").selectAll().where(
        "companyId",
        "=",
        companyId,
      )
        .where("id", "in", memoIds).orderBy("id").forUpdate().execute()
      : [];
    if (memos.length !== memoIds.length) {
      throw new Error("Staged memo not found in this company");
    }
    const memoConsumption = memoIds.length
      ? (await settlementQuery(trx, companyId).where("s.memoId", "in", memoIds)
        .execute()).filter(effective)
      : [];
    const memoRemaining = new Map(memos.map((memo) => {
      if (
        memo.status !== "Posted" ||
        memo.currencyCode !== payment.currencyCode ||
        (isAR ? memo.customerId : memo.supplierId) !== partyId ||
        memo.direction !== (isAR ? "Credit" : "Debit")
      ) {
        throw new Error(
          "Staged memo must be posted with matching party, currency and direction",
        );
      }
      toBaseAmount(0, Number(memo.exchangeRate));
      return [memo.id, {
        memo,
        document: toDocumentAmount(Number(memo.amount), 1, decimals) -
          memoConsumption.filter((row) => row.memoId === memo.id).reduce(
            (sum, row) => sum + principal(row.sourceAmount, row.id),
            0,
          ),
      }] as [string, { memo: typeof memo; document: number }];
    }));
    const normalizedMemos: Array<
      {
        id: string;
        appliedAmount: number;
        sourceAmount: number;
        sourceExchangeRate: number;
        targetExchangeRate: number;
      }
    > = [];
    for (const draft of drafts.filter((row) => row.memoId !== null)) {
      if (
        draft.paymentId || draft.sourcePaymentId ||
        Number(draft.discountAmount) !== 0 || Number(draft.writeOffAmount) !== 0
      ) {
        throw new Error(
          "Memo applications cannot carry payment funding, discounts or write-offs",
        );
      }
      const target = targets.get(draft[targetColumn]!)!;
      const source = memoRemaining.get(draft.memoId!)!;
      if (Number(source.memo.exchangeRate) !== target.rate) {
        throw new Error("Memo and invoice exchange-rate snapshots must match");
      }
      const sourceAmount = draft.sourceAmount === null
        ? toDocumentAmount(Number(draft.appliedAmount), target.rate, decimals)
        : principal(draft.sourceAmount, draft.id);
      if (
        toDocumentAmount(sourceAmount, 1, decimals) !== sourceAmount ||
        sourceAmount > source.document ||
        sourceAmount > target.remainingDocument
      ) throw new Error("Staged memo principal exceeds remaining balance");
      const appliedAmount = sourceAmount === target.remainingDocument
        ? target.remainingBase
        : toBaseAmount(sourceAmount, target.rate);
      if (appliedAmount > target.remainingBase) {
        throw new Error("Staged memo exceeds target carrying balance");
      }
      source.document = toDocumentAmount(
        source.document - sourceAmount,
        1,
        decimals,
      );
      target.remainingDocument = toDocumentAmount(
        target.remainingDocument - sourceAmount,
        1,
        decimals,
      );
      target.remainingBase = round(target.remainingBase - appliedAmount);
      normalizedMemos.push({
        id: draft.id,
        appliedAmount,
        sourceAmount,
        sourceExchangeRate: target.rate,
        targetExchangeRate: target.rate,
      });
    }

    const sources = await trx.selectFrom("payment").selectAll().where(
      "companyId",
      "=",
      companyId,
    )
      .where("status", "=", "Posted").where(
        "paymentType",
        "=",
        isAR ? "Receipt" : "Disbursement",
      )
      .where(isAR ? "customerId" : "supplierId", "=", partyId).where(
        "currencyCode",
        "=",
        payment.currencyCode,
      )
      .where("id", "!=", paymentId).orderBy("id").forUpdate().execute();
    const sourceIds = sources.map((source) => source.id);
    const consumed = sourceIds.length
      ? (await settlementQuery(trx, companyId).where((eb) =>
        eb.or([
          eb("s.sourcePaymentId", "in", sourceIds),
          eb.and([
            eb("s.sourcePaymentId", "is", null),
            eb("s.paymentId", "in", sourceIds),
          ]),
        ])
      ).execute()).filter(effective)
      : [];
    const priorSources: FundingSource[] = sources.map((source) => {
      let remainingDocument = Number(source.totalAmount);
      let remainingBase = toBaseAmount(
        remainingDocument,
        Number(source.exchangeRate),
      );
      for (const row of consumed) {
        if ((row.sourcePaymentId ?? row.paymentId) === source.id) {
          remainingDocument = toDocumentAmount(
            remainingDocument - principal(row.sourceAmount, row.id),
            1,
            decimals,
          );
          remainingBase = round(
            remainingBase - Number(row.appliedAmount) -
              (isAR
                ? Number(row.fxGainLossAmount)
                : -Number(row.fxGainLossAmount)),
          );
        }
      }
      return {
        paymentId: source.id,
        postingDate: source.postingDate ?? source.paymentDate,
        exchangeRate: Number(source.exchangeRate),
        remainingDocument,
        remainingBase,
      };
    });
    const requestByTarget = new Map<string, FundingRequest>();
    for (const draft of drafts.filter((row) => row.paymentId === paymentId)) {
      const targetId = draft[targetColumn]!;
      const target = targets.get(targetId)!;
      const requested = draft.sourceAmount === null
        ? (Number(draft.appliedAmount) === target.remainingBase &&
            Number(draft.discountAmount) === 0 &&
            Number(draft.writeOffAmount) === 0
          ? target.remainingDocument
          : toDocumentAmount(
            Number(draft.appliedAmount),
            target.rate,
            decimals,
          ))
        : principal(draft.sourceAmount, draft.id);
      if (toDocumentAmount(requested, 1, decimals) !== requested) {
        throw new Error(
          "Requested principal exceeds document currency precision",
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
      };
      request.requestedDocumentPrincipal = toDocumentAmount(
        request.requestedDocumentPrincipal + requested,
        1,
        decimals,
      );
      request.discountAmount = round(
        request.discountAmount + Number(draft.discountAmount),
      );
      request.writeOffAmount = round(
        request.writeOffAmount + Number(draft.writeOffAmount),
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
          Number(payment.exchangeRate),
        ),
      },
      priorSources,
      requests: [...requestByTarget.values()].sort((a, b) =>
        a.targetId.localeCompare(b.targetId)
      ),
      currencyDecimals: decimals,
      isAR,
    });

    const defaults = await trx.selectFrom("accountDefault").selectAll().where(
      "companyId",
      "=",
      companyId,
    ).executeTakeFirst();
    const party = isAR
      ? await trx.selectFrom("customer").select([
        "customerTypeId as typeId",
        "intercompanyCompanyId",
      ]).where("id", "=", partyId).where("companyId", "=", companyId)
        .executeTakeFirst()
      : await trx.selectFrom("supplier").select([
        "supplierTypeId as typeId",
        "intercompanyCompanyId",
      ]).where("id", "=", partyId).where("companyId", "=", companyId)
        .executeTakeFirst();
    if (!party) throw new Error("Payment counterparty not found");
    const normalized = allocation.applications.map((application) => ({
      ...application,
      targetSalesInvoiceId: isAR ? application.targetId : null,
      targetPurchaseInvoiceId: isAR ? null : application.targetId,
    }));
    let journalLines: ReturnType<typeof buildPaymentJournal>["lines"] = [];
    const expectedAccountClasses: Array<[string | null | undefined, string]> = [
      [payment.bankAccount, "Asset"],
    ];
    if (accountingEnabled) {
      if (!defaults) {
        throw new Error("Accounting defaults are required before posting");
      }
      const accounts = {
        controlAccountId: isAR
          ? (party.intercompanyCompanyId
            ? defaults.intercompanyReceivablesAccount
            : defaults.receivablesAccount)
          : (party.intercompanyCompanyId
            ? defaults.intercompanyPayablesAccount
            : defaults.payablesAccount),
        discountAccountId: isAR
          ? defaults.customerPaymentDiscountAccount
          : defaults.supplierPaymentDiscountAccount,
        writeOffAccountId: isAR
          ? defaults.customerWriteOffAccount
          : defaults.supplierWriteOffAccount,
        fxGainAccountId: defaults.realizedExchangeGainAccount,
        fxLossAccountId: defaults.realizedExchangeLossAccount,
      };
      expectedAccountClasses.push(
        [accounts.controlAccountId, isAR ? "Asset" : "Liability"],
        [accounts.discountAccountId, "Expense"],
        [accounts.writeOffAccountId, isAR ? "Expense" : "Revenue"],
        [accounts.fxGainAccountId, "Revenue"],
        [accounts.fxLossAccountId, "Expense"],
        [fee?.accountId, "Expense"],
      );
      journalLines = buildPaymentJournal({
        paymentId,
        companyId,
        isAR,
        cashIn,
        totalAmount: Number(payment.totalAmount),
        exchangeRate: Number(payment.exchangeRate),
        bankAccount: payment.bankAccount,
        journalLineReference: nanoid(),
        applications: normalized,
        newOnAccountBase: allocation.sourceRemainders[0].remainingBase,
        fee,
        accounts,
      }).lines;
    }
    const accountIds = [
      ...new Set([
        payment.bankAccount,
        ...journalLines.map((line) => line.accountId),
      ]),
    ];
    const postingAccounts = await trx.selectFrom("account").select([
      "id",
      "class",
    ])
      .where("id", "in", accountIds).where(
        "companyGroupId",
        "=",
        company.companyGroupId,
      )
      .where("active", "=", true).where("isGroup", "=", false).execute();
    if (
      postingAccounts.length !== accountIds.length ||
      postingAccounts.find((account) => account.id === payment.bankAccount)
          ?.class !== "Asset"
    ) {
      throw new Error(
        "Payment accounts must be active posting accounts in this company group, with an Asset bank account",
      );
    }
    const classById = new Map(
      postingAccounts.map((account) => [account.id, account.class]),
    );
    if (
      expectedAccountClasses.some(([id, expected]) =>
        id && classById.has(id) && classById.get(id) !== expected
      )
    ) {
      throw new Error("Payment account class does not match its posting role");
    }
    // Replace current-cash/prior-credit splits only after all authoritative
    // validation. The entire replacement, journal and status share this transaction.
    await trx.deleteFrom("invoiceSettlement").where("paymentId", "=", paymentId)
      .where("companyId", "=", companyId).execute();
    if (normalized.length) {
      await trx.insertInto("invoiceSettlement").values(
        normalized.map(({ targetId: _, ...application }) => ({
          ...application,
          paymentId,
          companyId,
          appliedDate: today,
          createdBy: userId,
        })),
      ).execute();
    }
    // One set-based UPDATE preserves memo row identities and avoids query-per-row writes.
    if (normalizedMemos.length) {
      const { sql } = await import("kysely");
      await sql`UPDATE "invoiceSettlement" s SET "appliedAmount"=v."appliedAmount", "sourceAmount"=v."sourceAmount",
        "sourceExchangeRate"=v."sourceExchangeRate", "targetExchangeRate"=v."targetExchangeRate", "fxGainLossAmount"=0, "appliedDate"=${today}::date, "updatedBy"=${userId}
        FROM jsonb_to_recordset(${
        JSON.stringify(normalizedMemos)
      }::jsonb) AS v(id text,"appliedAmount" numeric,"sourceAmount" numeric,"sourceExchangeRate" numeric,"targetExchangeRate" numeric)
        WHERE s.id=v.id AND s."companyId"=${companyId} AND s."appliedViaPaymentId"=${paymentId}`
        .execute(trx);
    }
    let journalId: string | null = null;
    if (accountingEnabled) {
      const journal = await trx.insertInto("journal").values({
        journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
        accountingPeriodId,
        description: `Payment ${payment.paymentId}`,
        postingDate: today,
        companyId,
        sourceType: "Payment",
        status: "Posted",
        postedAt: timestamp,
        postedBy: userId,
        createdBy: userId,
      }).returning("id").executeTakeFirstOrThrow();
      journalId = journal.id;
      if (journalLines.length) {
        const lines = await trx.insertInto("journalLine").values(
          journalLines.map((line) => ({ ...line, journalId: journal.id })),
        ).returning("id").execute();
        const dimensions = await trx.selectFrom("dimension").select([
          "id",
          "entityType",
        ]).where("companyGroupId", "=", company.companyGroupId)
          .where("active", "=", true).where(
            "entityType",
            "in",
            isAR ? ["CustomerType", "Customer"] : ["SupplierType", "Supplier"],
          ).execute();
        const values = dimensions.flatMap((dimension) => {
          const valueId =
            dimension.entityType === (isAR ? "Customer" : "Supplier")
              ? partyId
              : party.typeId;
          return valueId
            ? lines.map((line) => ({
              journalLineId: line.id,
              dimensionId: dimension.id,
              valueId,
              companyId,
            }))
            : [];
        });
        if (values.length) {
          await trx.insertInto("journalLineDimension").values(values).execute();
        }
      }
    }
    await trx.updateTable("payment").set({
      status: "Posted",
      postingDate: today,
      journalId,
      postedAt: timestamp,
      postedBy: userId,
      updatedAt: timestamp,
      updatedBy: userId,
    })
      .where("id", "=", paymentId).where("companyId", "=", companyId).execute();
    return { journalId };
  });
}
