import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

import {
  getAccountingPeriodForDate,
  getCurrentAccountingPeriod,
} from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import {
  buildCardTransactionJournal,
  type GLAccountClass,
} from "./build-card-transaction-journal.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  cardTransactionId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

// Find the first day of the earliest open accounting period that starts AFTER
// `afterDate`. Used to shift a card transaction's posting date out of a
// locked/closed period into the next period that will accept it. Returns null
// when there is no such period ahead (the caller re-throws the original error).
async function getFirstDayOfNextOpenPeriod(
  // deno-lint-ignore no-explicit-any
  client: any,
  companyId: string,
  afterDate: string
): Promise<string | null> {
  const periods = await client
    .from("accountingPeriod")
    .select("startDate, closeStatus, closedAt")
    .eq("companyId", companyId)
    .gt("startDate", afterDate)
    .order("startDate", { ascending: true });

  for (const period of periods.data ?? []) {
    const closeStatus =
      period.closeStatus ?? (period.closedAt ? "Closed" : "Open");
    if (closeStatus === "Open") return period.startDate as string;
  }
  return null;
}

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const payload = await req.json();

  try {
    const { type, cardTransactionId, userId, companyId } =
      payloadValidator.parse(payload);

    console.log({
      function: "post-card-transaction",
      type,
      cardTransactionId,
      userId,
      companyId,
    });

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

    const [cardTx, cardLinesResult] = await Promise.all([
      client
        .from("cardTransaction")
        .select("*")
        .eq("id", cardTransactionId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("cardTransactionLine")
        .select("*")
        .eq("cardTransactionId", cardTransactionId)
        .eq("companyId", companyId)
        .order("sequence", { ascending: true }),
    ]);

    if (cardTx.error) throw new Error("Failed to fetch card transaction");
    if (cardLinesResult.error)
      throw new Error("Failed to fetch card transaction lines");

    const cardTransaction = cardTx.data;
    const lines = cardLinesResult.data;

    // --------------------------------------------------------------
    // VOID — reverse the posted journal, flip status to Voided.
    // --------------------------------------------------------------
    if (type === "void") {
      if (cardTransaction.status !== "Posted") {
        throw new Error(
          `Cannot void card transaction in status ${cardTransaction.status} (only Posted)`
        );
      }

      const today = datetime
        .today(await getCompanyTimeZone(client, companyId))
        .toString();
      const accountingPeriodId = accountingEnabled
        ? await getCurrentAccountingPeriod(client, companyId, db, today)
        : null;

      await db.transaction().execute(async (trx) => {
        // Lock + re-assert Posted inside the transaction (TOCTOU guard) so two
        // concurrent voids can't each emit a reversing journal.
        const locked = await trx
          .selectFrom("cardTransaction")
          .select(["id", "status"])
          .where("id", "=", cardTransactionId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!locked) throw new Error("Card transaction not found");
        if (locked.status !== "Posted") {
          throw new Error(
            `Cannot void card transaction in status ${locked.status} (only Posted)`
          );
        }

        if (accountingEnabled && cardTransaction.journalId) {
          const originalLines = await trx
            .selectFrom("journalLine")
            .selectAll()
            .where("journalId", "=", cardTransaction.journalId)
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
                description: `VOID Card Transaction ${cardTransaction.cardTransactionId}`,
                postingDate: today,
                companyId,
                sourceType: "Card Transaction",
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
                  documentType: "Card Transaction" as const,
                  documentId: cardTransactionId,
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
          .updateTable("cardTransaction")
          .set({
            status: "Voided",
            voidedAt: new Date().toISOString(),
            voidedBy: userId,
            updatedAt: new Date().toISOString(),
            updatedBy: userId,
          })
          .where("id", "=", cardTransactionId)
          .where("companyId", "=", companyId)
          .execute();
      });

      return jsonResponse({ success: true });
    }

    // --------------------------------------------------------------
    // POST
    // --------------------------------------------------------------
    if (cardTransaction.status !== "Draft") {
      throw new Error(
        `Cannot post card transaction in status ${cardTransaction.status} (only Draft)`
      );
    }

    // Resolve the posting date: the explicit postingDate, else the calendar day
    // of the transaction date. Date-only string slice — never JS Date arithmetic.
    let postingDate =
      cardTransaction.postingDate ??
      cardTransaction.transactionDate.slice(0, 10);

    // Resolve the accounting period. If the target period is Locked/Closed,
    // shift to the first day of the next open period and re-resolve, writing the
    // shifted date back to the card transaction on update.
    let accountingPeriodId: string | null = null;
    if (accountingEnabled) {
      try {
        accountingPeriodId = await getAccountingPeriodForDate(
          client,
          companyId,
          db,
          postingDate
        );
      } catch (periodErr) {
        const shifted = await getFirstDayOfNextOpenPeriod(
          client,
          companyId,
          postingDate
        );
        if (!shifted) throw periodErr;
        postingDate = shifted;
        accountingPeriodId = await getAccountingPeriodForDate(
          client,
          companyId,
          db,
          shifted
        );
      }
    }

    // Resolve the account classes the builder needs (card, offset, every line).
    const journalLineReference = nanoid();
    let journalLines: ReturnType<
      typeof buildCardTransactionJournal
    >["journalLines"] = [];
    let costCenterDimensionId: string | null = null;

    if (accountingEnabled) {
      const accountIds = [
        cardTransaction.cardAccountId,
        cardTransaction.offsetAccountId,
        ...lines.map((l) => l.accountId),
      ].filter((id): id is string => Boolean(id));

      // `account` (chart of accounts) is scoped by companyGroupId, not
      // companyId — its PK is `id` alone and ids are globally unique. The ids
      // here come from this company's own cardTransaction + lines, so an
      // id-only lookup is both correct and tenant-safe. (An `.eq("companyId")`
      // here errors: the column does not exist on `account`. Mirrors
      // post-purchase-invoice / post-memo, which also filter by id only.)
      const accountsResult = await client
        .from("account")
        .select("id, class")
        .in("id", [...new Set(accountIds)]);
      if (accountsResult.error)
        throw new Error("Failed to fetch card transaction accounts");

      const accounts: Record<string, { class: GLAccountClass }> = {};
      for (const account of accountsResult.data ?? []) {
        if (account.class)
          accounts[account.id] = {
            class: account.class as GLAccountClass,
          };
      }

      const built = buildCardTransactionJournal({
        transaction: {
          type: cardTransaction.type,
          amount: Number(cardTransaction.amount),
          cardAccountId: cardTransaction.cardAccountId,
          offsetAccountId: cardTransaction.offsetAccountId,
          currencyCode: cardTransaction.currencyCode,
          exchangeRate: Number(cardTransaction.exchangeRate),
        },
        lines: lines.map((l) => ({
          accountId: l.accountId,
          amount: Number(l.amount),
          costCenterId: l.costCenterId,
          description: l.description,
        })),
        accounts,
        documentId: cardTransaction.id,
        documentReadableId: cardTransaction.cardTransactionId,
      });
      journalLines = built.journalLines;

      // The CostCenter dimension is company-group scoped; a line tagged with a
      // costCenterId gets a journalLineDimension pointing at it.
      const companyRecord = await client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single();
      const companyGroupId = companyRecord.data?.companyGroupId ?? null;
      if (companyGroupId) {
        const dim = await client
          .from("dimension")
          .select("id")
          .eq("companyGroupId", companyGroupId)
          .eq("active", true)
          .eq("entityType", "CostCenter")
          .maybeSingle();
        costCenterDimensionId = dim.data?.id ?? null;
      }
    }

    let createdJournalId: string | null = null;
    await db.transaction().execute(async (trx) => {
      // Lock + re-assert Draft inside the transaction (TOCTOU guard).
      const locked = await trx
        .selectFrom("cardTransaction")
        .select(["id", "status"])
        .where("id", "=", cardTransactionId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw new Error("Card transaction not found");
      if (locked.status !== "Draft") {
        throw new Error(
          `Cannot post card transaction in status ${locked.status} (only Draft)`
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
            description: `Card Transaction ${cardTransaction.cardTransactionId}`,
            postingDate,
            companyId,
            sourceType: "Card Transaction",
            status: "Posted",
            postedAt: new Date().toISOString(),
            postedBy: userId,
            createdBy: userId,
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        journalId = journalResult.id;

        if (journalLines.length > 0) {
          const journalLineResults = await trx
            .insertInto("journalLine")
            .values(
              journalLines.map((line) => ({
                journalId: journalResult.id,
                accountId: line.accountId,
                amount: line.amount,
                quantity: 1,
                description: line.description,
                documentType: "Card Transaction" as const,
                documentId: line.documentId,
                journalLineReference,
                companyId,
              }))
            )
            .returning(["id"])
            .execute();

          // Insert cost-center dimensions for lines that carry one. Insert order
          // matches journalLines order, so index alignment is safe.
          if (costCenterDimensionId) {
            const dimensionInserts: {
              journalLineId: string;
              dimensionId: string;
              valueId: string;
              companyId: string;
            }[] = [];
            journalLineResults.forEach((jl, index) => {
              const costCenterId = journalLines[index]?.costCenterId;
              if (costCenterId) {
                dimensionInserts.push({
                  journalLineId: jl.id,
                  dimensionId: costCenterDimensionId!,
                  valueId: costCenterId,
                  companyId,
                });
              }
            });
            if (dimensionInserts.length > 0) {
              await trx
                .insertInto("journalLineDimension")
                .values(dimensionInserts)
                .execute();
            }
          }
        }
      }

      await trx
        .updateTable("cardTransaction")
        .set({
          status: "Posted",
          journalId,
          postingDate,
          postedAt: new Date().toISOString(),
          postedBy: userId,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
        })
        .where("id", "=", cardTransactionId)
        .where("companyId", "=", companyId)
        .execute();

      createdJournalId = journalId;
    });

    return jsonResponse({ success: true, journalId: createdJournalId });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
