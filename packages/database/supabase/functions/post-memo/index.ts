import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import { buildMemoJournal, type MemoJournalLine } from "./build-memo-journal.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  memoId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    const { type, memoId, userId, companyId } = payloadValidator.parse(payload);

    console.log({ function: "post-memo", type, memoId, userId, companyId });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const accountingSettings = await client
      .from("companySettings")
      .select("accountingEnabled")
      .eq("id", companyId)
      .single();
    const accountingEnabled =
      accountingSettings.data?.accountingEnabled ?? false;

    const [memo, accountDefaults] = await Promise.all([
      client.from("memo").select("*").eq("id", memoId).single(),
      getDefaultPostingGroup(client, companyId),
    ]);

    if (memo.error) throw new Error("Failed to fetch memo");
    if (accountingEnabled && accountDefaults.error)
      throw new Error("Failed to fetch account defaults");

    // isAR: a customer memo settles AR; a supplier memo settles AP.
    const isAR = memo.data.customerId != null;

    // --------------------------------------------------------------
    // VOID
    // --------------------------------------------------------------
    if (type === "void") {
      if (memo.data.status !== "Posted") {
        throw new Error(
          `Cannot void memo in status ${memo.data.status} (only Posted)`
        );
      }

      const accountingPeriodId = accountingEnabled
        ? await getCurrentAccountingPeriod(client, companyId, db)
        : null;

      await db.transaction().execute(async (trx) => {
        // Lock the memo row and re-assert it's still Posted INSIDE the
        // transaction. The status check above runs before the lock (a TOCTOU
        // window): two concurrent voids could otherwise both pass it and each
        // emit a reversing journal. The FOR UPDATE serializes them.
        const lockedMemo = await trx
          .selectFrom("memo")
          .select(["id", "status"])
          .where("id", "=", memoId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!lockedMemo) throw new Error("Memo not found");
        if (lockedMemo.status !== "Posted") {
          throw new Error(
            `Cannot void memo in status ${lockedMemo.status} (only Posted)`
          );
        }

        if (accountingEnabled && memo.data.journalId) {
          // Mirror the original journal's lines into a reversing journal (the
          // same paired-journal approach post-payment/post-purchase-invoice use
          // for voids — never mutate the original).
          const originalLines = await trx
            .selectFrom("journalLine")
            .selectAll()
            .where("journalId", "=", memo.data.journalId)
            .execute();

          if (originalLines.length > 0) {
            const voidEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const voidJournal = await trx
              .insertInto("journal")
              .values({
                journalEntryId: voidEntryId,
                accountingPeriodId,
                description: `VOID Memo ${memo.data.memoId}`,
                postingDate: today,
                companyId,
                sourceType:
                  memo.data.direction === "Credit"
                    ? "Credit Memo"
                    : "Debit Memo",
                status: "Posted",
                postedAt: new Date().toISOString(),
                postedBy: userId,
                createdBy: userId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            const voidLineResults = await trx
              .insertInto("journalLine")
              .values(
                originalLines.map((line) => ({
                  journalId: voidJournal.id,
                  accountId: line.accountId,
                  amount: -line.amount,
                  quantity: line.quantity,
                  description: `VOID: ${line.description ?? ""}`,
                  documentType: "Memo" as const,
                  documentId: memoId,
                  documentLineReference: line.documentLineReference,
                  journalLineReference: line.journalLineReference,
                  companyId,
                }))
              )
              .returning(["id"])
              .execute();

            // Carry the original lines' dimensions onto the reversing lines so
            // dimension-filtered balances net to zero after the void.
            const origDimensions = await trx
              .selectFrom("journalLineDimension")
              .select(["journalLineId", "dimensionId", "valueId"])
              .where(
                "journalLineId",
                "in",
                originalLines.map((l) => l.id)
              )
              .execute();
            if (origDimensions.length > 0) {
              const idxByOriginalId = new Map(
                originalLines.map((l, i) => [l.id, i])
              );
              await trx
                .insertInto("journalLineDimension")
                .values(
                  origDimensions.map((d) => ({
                    journalLineId:
                      voidLineResults[idxByOriginalId.get(d.journalLineId)!].id,
                    dimensionId: d.dimensionId,
                    valueId: d.valueId,
                    companyId,
                  }))
                )
                .execute();
            }
          }
        }

        await trx
          .updateTable("memo")
          .set({
            status: "Voided",
            voidedAt: new Date().toISOString(),
            voidedBy: userId,
            updatedAt: new Date().toISOString(),
            updatedBy: userId,
          })
          .where("id", "=", memoId)
          .where("companyId", "=", companyId)
          .execute();
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --------------------------------------------------------------
    // POST
    // --------------------------------------------------------------
    if (memo.data.status !== "Draft") {
      throw new Error(
        `Cannot post memo in status ${memo.data.status} (only Draft)`
      );
    }
    if (memo.data.exchangeRate <= 0) {
      throw new Error("Memo exchange rate must be > 0");
    }

    const accountingPeriodId = accountingEnabled
      ? await getCurrentAccountingPeriod(client, companyId, db)
      : null;

    // Build the (balanced, two-line) journal in base currency. Account-id
    // resolution + the control/reason sign logic live in the pure
    // `buildMemoJournal` so they are unit-tested (post-memo.test.ts).
    const journalLineInserts: MemoJournalLine[] = [];
    const partyDimensions: { dimensionId: string; valueId: string }[] = [];
    // The offset ("reason") account is derived here (not a user choice) and
    // stored on the memo at posting for the audit trail / list display.
    let derivedReasonAccountId: string | null = null;

    if (accountingEnabled) {
      if (!accountDefaults.data) {
        throw new Error(
          "Accounting is enabled but this company has no account defaults configured"
        );
      }
      const ad = accountDefaults.data;
      const controlAccountId = isAR
        ? ad.receivablesAccount
        : ad.payablesAccount;

      // The offset account is deterministic by party side (NOT a user choice):
      // customer memos adjust sales (salesDiscountAccount); supplier memos adjust
      // purchases (supplierPaymentDiscountAccount). Direction only flips the
      // debit/credit side, handled inside buildMemoJournal.
      const reasonAccountId = isAR
        ? ad.salesDiscountAccount
        : ad.supplierPaymentDiscountAccount;
      if (!reasonAccountId) {
        throw new Error(
          `Missing ${
            isAR ? "salesDiscountAccount" : "supplierPaymentDiscountAccount"
          } account default; cannot post memo to GL`
        );
      }
      derivedReasonAccountId = reasonAccountId;

      // Resolve the reason account's class so its natural-balance amount sign is
      // correct (the account can be any class).
      const reasonAccount = await client
        .from("account")
        .select("class")
        .eq("id", reasonAccountId)
        .single();
      if (reasonAccount.error || !reasonAccount.data) {
        throw new Error("Failed to fetch the derived reason account");
      }

      const journalLineReference = nanoid();
      const { lines } = buildMemoJournal({
        memoId,
        companyId,
        isAR,
        direction: memo.data.direction as "Credit" | "Debit",
        amountBase: Number(memo.data.amount) * Number(memo.data.exchangeRate),
        journalLineReference,
        controlAccountId,
        reasonAccountId,
        reasonAccountClass: reasonAccount.data.class as string,
      });
      journalLineInserts.push(...lines);

      // Tag the journal lines with the counterparty type + entity dimensions so
      // AR/AP can be reported by counterparty (mirrors post-payment).
      const companyRecord = await client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single();
      const companyGroupId = companyRecord.data?.companyGroupId ?? null;
      const partyId = isAR
        ? (memo.data.customerId as string | null)
        : (memo.data.supplierId as string | null);
      const typeEntityType = isAR ? "CustomerType" : "SupplierType";
      const entityEntityType = isAR ? "Customer" : "Supplier";
      if (companyGroupId && partyId) {
        const [partyRow, dimRows] = await Promise.all([
          isAR
            ? client
                .from("customer")
                .select("customerTypeId")
                .eq("id", partyId)
                .maybeSingle()
            : client
                .from("supplier")
                .select("supplierTypeId")
                .eq("id", partyId)
                .maybeSingle(),
          client
            .from("dimension")
            .select("id, entityType")
            .eq("companyGroupId", companyGroupId)
            .eq("active", true)
            .in("entityType", [typeEntityType, entityEntityType]),
        ]);
        const dimByEntityType = new Map<string, string>();
        for (const d of dimRows.data ?? []) {
          if (d.entityType) dimByEntityType.set(d.entityType, d.id);
        }
        // deno-lint-ignore no-explicit-any
        const party = partyRow.data as any;
        const partyTypeId = isAR
          ? (party?.customerTypeId ?? null)
          : (party?.supplierTypeId ?? null);
        const typeDimensionId = dimByEntityType.get(typeEntityType);
        if (typeDimensionId && partyTypeId) {
          partyDimensions.push({
            dimensionId: typeDimensionId,
            valueId: partyTypeId,
          });
        }
        const entityDimensionId = dimByEntityType.get(entityEntityType);
        if (entityDimensionId) {
          partyDimensions.push({ dimensionId: entityDimensionId, valueId: partyId });
        }
      }
    }

    // --------------------------------------------------------------
    // Commit: lock the memo, re-check Draft, post the journal, flip Posted.
    // Applying a memo to invoices is GL-neutral (both sit in AR/AP), so there is
    // no invoice validation here — that lives in replaceMemoSettlements.
    // --------------------------------------------------------------
    let createdJournalId: string | null = null;
    await db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom("memo")
        .select(["id", "status"])
        .where("id", "=", memoId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw new Error("Memo not found");
      if (locked.status !== "Draft") {
        throw new Error(
          `Cannot post memo in status ${locked.status} (only Draft)`
        );
      }

      let journalId: string | null = null;
      if (accountingEnabled) {
        const journalEntryId = await getNextSequence(
          trx,
          "journalEntry",
          companyId
        );
        const journalResult = await trx
          .insertInto("journal")
          .values({
            journalEntryId,
            accountingPeriodId,
            description: `${memo.data.direction} Memo ${memo.data.memoId}`,
            postingDate: today,
            companyId,
            sourceType:
              memo.data.direction === "Credit" ? "Credit Memo" : "Debit Memo",
            status: "Posted",
            postedAt: new Date().toISOString(),
            postedBy: userId,
            createdBy: userId,
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        journalId = journalResult.id;

        if (journalLineInserts.length > 0) {
          const journalLineResults = await trx
            .insertInto("journalLine")
            .values(
              journalLineInserts.map((line) => ({
                ...line,
                journalId: journalResult.id,
              }))
            )
            .returning(["id"])
            .execute();

          if (partyDimensions.length > 0) {
            await trx
              .insertInto("journalLineDimension")
              .values(
                journalLineResults.flatMap((jl) =>
                  partyDimensions.map((d) => ({
                    journalLineId: jl.id,
                    dimensionId: d.dimensionId,
                    valueId: d.valueId,
                    companyId,
                  }))
                )
              )
              .execute();
          }
        }
      }

      await trx
        .updateTable("memo")
        .set({
          status: "Posted",
          postingDate: today,
          journalId,
          reasonAccount: derivedReasonAccountId,
          postedAt: new Date().toISOString(),
          postedBy: userId,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
        })
        .where("id", "=", memoId)
        .where("companyId", "=", companyId)
        .execute();

      createdJournalId = journalId;
    });

    return new Response(
      JSON.stringify({ success: true, journalId: createdJournalId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
