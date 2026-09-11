import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createMappingService } from "@carbon/ee/accounting";
import { type Kysely, sql } from "kysely";

type CardTransactionStatus =
  Database["public"]["Enums"]["cardTransactionStatus"];
type CardTransactionType = Database["public"]["Enums"]["cardTransactionType"];

export type RampCardLineDraft = {
  accountId: string;
  amount: number;
  costCenterId: string | null;
  description: string | null;
};

export type RampCardDraft = {
  rampId: string;
  companyId: string;
  actorId: string;
  readableId?: string;
  type: CardTransactionType;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
  transactionDate: string;
  postingDate: string | null;
  cardAccountId: string;
  offsetAccountId: string | null;
  merchantName: string | null;
  supplierId: string | null;
  cardHolderName: string | null;
  memo: string | null;
  lines: RampCardLineDraft[];
};

export type StagedRampCardTransaction = {
  cardTransactionId: string;
  readableId: string;
  status: CardTransactionStatus;
  created: boolean;
};

/**
 * Atomically stage the local card document and its Ramp source identity.
 * The advisory lock prevents two workers from creating different local rows
 * before the mapping uniqueness constraint is reached.
 */
export async function stageOrResumeRampCardTransaction(
  db: Kysely<KyselyDatabase>,
  args: RampCardDraft
): Promise<StagedRampCardTransaction> {
  return db.transaction().execute(async (tx) => {
    await sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`ramp:cardTransaction:${args.companyId}:${args.rampId}`},
          0
        )
      )
    `.execute(tx);

    const mapping = createMappingService(tx, args.companyId);
    const mapped = await mapping.getByExternalId(
      "ramp",
      args.rampId,
      "cardTransaction"
    );
    if (mapped) {
      const existing = await tx
        .selectFrom("cardTransaction")
        .select(["id", "cardTransactionId", "status"])
        .where("id", "=", mapped.entityId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!existing) {
        throw new Error("Mapped Ramp card transaction no longer exists");
      }
      return {
        cardTransactionId: existing.id,
        readableId: existing.cardTransactionId,
        status: existing.status,
        created: false
      };
    }

    const sequence = args.readableId
      ? args.readableId
      : (
          await sql<{ get_next_sequence: string }>`
            SELECT get_next_sequence('cardTransaction', ${args.companyId}) as get_next_sequence
          `.execute(tx)
        ).rows[0]?.get_next_sequence;
    if (!sequence) {
      throw new Error("Failed to generate card transaction number");
    }

    const header = await tx
      .insertInto("cardTransaction")
      .values({
        cardTransactionId: sequence,
        type: args.type,
        status: "Draft",
        integration: "ramp",
        cardAccountId: args.cardAccountId,
        offsetAccountId: args.offsetAccountId,
        merchantName: args.merchantName,
        supplierId: args.supplierId,
        cardHolderName: args.cardHolderName,
        memo: args.memo,
        transactionDate: args.transactionDate,
        postingDate: args.postingDate,
        currencyCode: args.currencyCode,
        exchangeRate: args.exchangeRate,
        amount: args.amount,
        companyId: args.companyId,
        createdBy: args.actorId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    if (args.lines.length > 0) {
      await tx
        .insertInto("cardTransactionLine")
        .values(
          args.lines.map((line, index) => ({
            cardTransactionId: header.id,
            companyId: args.companyId,
            accountId: line.accountId,
            costCenterId: line.costCenterId,
            description: line.description,
            amount: line.amount,
            sequence: index,
            createdBy: args.actorId
          }))
        )
        .execute();
    }

    await mapping.link("cardTransaction", header.id, "ramp", args.rampId, {
      createdBy: args.actorId
    });

    return {
      cardTransactionId: header.id,
      readableId: sequence,
      status: "Draft",
      created: true
    };
  });
}
