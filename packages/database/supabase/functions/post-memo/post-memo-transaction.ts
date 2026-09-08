import type { Kysely } from "kysely";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DB } from "../lib/database.ts";
import type { Database } from "../lib/types.ts";
import { datetime } from "../lib/datetime.ts";
import {
  toBaseAmount,
  toDocumentAmount,
} from "../shared/accounting-currency.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { buildMemoJournal } from "./build-memo-journal.ts";

export type PostMemoArgs = {
  type: "post" | "void";
  memoId: string;
  companyId: string;
  userId: string;
  today: string;
  client: SupabaseClient<Database>;
};

/** The endpoint's commit boundary. Headers, defaults and account classes come from this transaction. */
export function postMemoTransaction(
  db: Kysely<DB>,
  args: PostMemoArgs,
): Promise<{ journalId: string | null }> {
  const { type, memoId, companyId, userId, today, client } = args;
  return db.transaction().execute(async (trx) => {
    const memo = await trx.selectFrom("memo").selectAll().where(
      "id",
      "=",
      memoId,
    ).where("companyId", "=", companyId).forUpdate().executeTakeFirst();
    if (!memo) throw new Error("Memo not found");
    if (type === "post" && memo.status === "Posted") {
      return { journalId: memo.journalId };
    }
    if (type === "void" && memo.status === "Voided") {
      return { journalId: memo.journalId };
    }
    if (memo.status !== (type === "post" ? "Draft" : "Posted")) {
      throw new Error(`Cannot ${type} memo in status ${memo.status}`);
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
      const period = await trx.selectFrom("accountingPeriod").select([
        "id",
        "closeStatus",
        "closedAt",
      ])
        .where("id", "=", accountingPeriodId).where("companyId", "=", companyId)
        .forShare().executeTakeFirst();
      if (
        !period || period.closeStatus === "Locked" ||
        period.closeStatus === "Closed" || period.closedAt
      ) throw new Error("Accounting period is closed or locked");
    }
    if (type === "void") {
      let journalId: string | null = null;
      if (memo.journalId) {
        if (!accountingPeriodId) {
          throw new Error(
            "Enable accounting before reversing a posted memo journal",
          );
        }
        const originalJournal = await trx.selectFrom("journal").select([
          "id",
          "status",
          "sourceType",
        ])
          .where("id", "=", memo.journalId).where("companyId", "=", companyId)
          .executeTakeFirst();
        if (
          !originalJournal || originalJournal.status !== "Posted" ||
          originalJournal.sourceType !==
            (memo.direction === "Credit" ? "Credit Memo" : "Debit Memo")
        ) throw new Error("Original memo journal not found in this company");
        const original = await trx.selectFrom("journalLine").selectAll().where(
          "journalId",
          "=",
          memo.journalId,
        ).where("companyId", "=", companyId).orderBy("id").execute();
        if (!original.length) {
          throw new Error("Original memo journal has no lines to reverse");
        }
        const reversed = await trx.insertInto("journal").values({
          journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
          accountingPeriodId,
          description: `VOID Memo ${memo.memoId}`,
          postingDate: today,
          companyId,
          sourceType: originalJournal.sourceType,
          status: "Posted",
          postedAt: timestamp,
          postedBy: userId,
          createdBy: userId,
        }).returning("id").executeTakeFirstOrThrow();
        journalId = reversed.id;
        const lines = await trx.insertInto("journalLine").values(
          original.map((line) => ({
            journalId: reversed.id,
            accountId: line.accountId,
            amount: -Number(line.amount),
            quantity: line.quantity,
            description: `VOID: ${line.description ?? ""}`,
            documentType: "Memo" as const,
            documentId: memoId,
            documentLineReference: line.documentLineReference,
            journalLineReference: line.journalLineReference,
            companyId,
          })),
        ).returning("id").execute();
        const dimensions = await trx.selectFrom("journalLineDimension").select([
          "journalLineId",
          "dimensionId",
          "valueId",
        ])
          .where("companyId", "=", companyId).where(
            "journalLineId",
            "in",
            original.map((line) => line.id),
          ).execute();
        const reverseByOriginal = new Map(
          original.map((line, index) => [line.id, lines[index].id]),
        );
        if (dimensions.length) {
          await trx.insertInto("journalLineDimension").values(
            dimensions.map((d) => ({
              ...d,
              journalLineId: reverseByOriginal.get(d.journalLineId)!,
              companyId,
            })),
          ).execute();
        }
      }
      await trx.updateTable("memo").set({
        status: "Voided",
        voidedAt: timestamp,
        voidedBy: userId,
        updatedAt: timestamp,
        updatedBy: userId,
      }).where("id", "=", memoId).where("companyId", "=", companyId).execute();
      return { journalId };
    }

    if (Boolean(memo.customerId) === Boolean(memo.supplierId)) {
      throw new Error("Memo must have exactly one customer or supplier");
    }
    const isAR = Boolean(memo.customerId);
    const partyId = (isAR ? memo.customerId : memo.supplierId)!;
    const company = await trx.selectFrom("company").select([
      "companyGroupId",
      "baseCurrencyCode",
    ]).where("id", "=", companyId).executeTakeFirst();
    if (!company?.companyGroupId || !memo.currencyCode) {
      throw new Error("Memo currency configuration is missing");
    }
    const currency = await trx.selectFrom("currency").select("decimalPlaces")
      .where("companyGroupId", "=", company.companyGroupId).where(
        "code",
        "=",
        memo.currencyCode,
      ).executeTakeFirst();
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
    if (!party) throw new Error("Memo counterparty not found in this company");
    let journalId: string | null = null;
    let reasonAccountId: string | null = null;
    if (accountingEnabled) {
      const defaults = await trx.selectFrom("accountDefault").selectAll().where(
        "companyId",
        "=",
        companyId,
      ).executeTakeFirst();
      if (!defaults) {
        throw new Error("Accounting defaults are required before posting");
      }
      const controlAccountId = isAR
        ? defaults.receivablesAccount
        : defaults.payablesAccount;
      reasonAccountId = isAR
        ? defaults.salesDiscountAccount
        : defaults.supplierPaymentDiscountAccount;
      if (!controlAccountId || !reasonAccountId) {
        throw new Error(
          "Memo control and reason account defaults are required",
        );
      }
      const accountIds = [...new Set([controlAccountId, reasonAccountId])];
      const accounts = await trx.selectFrom("account").select(["id", "class"])
        .where("id", "in", accountIds).where(
          "companyGroupId",
          "=",
          company.companyGroupId,
        ).where("active", "=", true).where("isGroup", "=", false).execute();
      const control = accounts.find((a) => a.id === controlAccountId);
      const reason = accounts.find((a) => a.id === reasonAccountId);
      if (
        accounts.length !== accountIds.length ||
        control?.class !== (isAR ? "Asset" : "Liability") || !reason?.class
      ) {
        throw new Error(
          "Memo accounts must be active posting accounts in this company group with the correct control class",
        );
      }
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
      });
      const journal = await trx.insertInto("journal").values({
        journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
        accountingPeriodId,
        description: `${memo.direction} Memo ${memo.memoId}`,
        postingDate: today,
        companyId,
        sourceType: memo.direction === "Credit" ? "Credit Memo" : "Debit Memo",
        status: "Posted",
        postedAt: timestamp,
        postedBy: userId,
        createdBy: userId,
      }).returning("id").executeTakeFirstOrThrow();
      journalId = journal.id;
      const inserted = await trx.insertInto("journalLine").values(
        lines.map((line) => ({ ...line, journalId: journal.id })),
      ).returning("id").execute();
      const dimensions = await trx.selectFrom("dimension").select([
        "id",
        "entityType",
      ]).where("companyGroupId", "=", company.companyGroupId).where(
        "active",
        "=",
        true,
      ).where(
        "entityType",
        "in",
        isAR ? ["CustomerType", "Customer"] : ["SupplierType", "Supplier"],
      ).execute();
      const dimensionValues = dimensions.flatMap((d) => {
        const valueId = d.entityType === (isAR ? "Customer" : "Supplier")
          ? partyId
          : party.typeId;
        return valueId
          ? inserted.map((line) => ({
            journalLineId: line.id,
            dimensionId: d.id,
            valueId,
            companyId,
          }))
          : [];
      });
      if (dimensionValues.length) {
        await trx.insertInto("journalLineDimension").values(dimensionValues)
          .execute();
      }
    }
    await trx.updateTable("memo").set({
      status: "Posted",
      postingDate: today,
      journalId,
      reasonAccount: reasonAccountId,
      postedAt: timestamp,
      postedBy: userId,
      updatedAt: timestamp,
      updatedBy: userId,
    }).where("id", "=", memoId).where("companyId", "=", companyId).execute();
    return { journalId };
  });
}
