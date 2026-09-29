import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createMappingService } from "@carbon/ee/accounting";
import { type Kysely, sql } from "kysely";

type ChargeStatus = Database["public"]["Enums"]["chargeStatus"];
type ChargeType = Database["public"]["Enums"]["chargeType"];

export type RampCardLineDraft = {
  accountId: string;
  amount: number;
  costCenterId: string | null;
  projectId: string | null;
  description: string | null;
};

export type RampCardDraft = {
  rampId: string;
  companyId: string;
  actorId: string;
  readableId?: string;
  type: ChargeType;
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

export type StagedRampCharge = {
  chargeId: string;
  readableId: string;
  status: ChargeStatus;
  created: boolean;
};

/**
 * Atomically stage the local card document and its Ramp source identity.
 * The advisory lock prevents two workers from creating different local rows
 * before the mapping uniqueness constraint is reached.
 */
export async function stageOrResumeRampCharge(
  db: Kysely<KyselyDatabase>,
  args: RampCardDraft
): Promise<StagedRampCharge> {
  return db.transaction().execute(async (tx) => {
    await sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`ramp:charge:${args.companyId}:${args.rampId}`},
          0
        )
      )
    `.execute(tx);

    const mapping = createMappingService(tx, args.companyId);
    const headerValues = {
      type: args.type,
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
      amount: args.amount
    };
    const lineValues = args.lines.map((line, index) => ({
      ...line,
      companyId: args.companyId,
      sequence: index,
      createdBy: args.actorId
    }));
    const mapped = await mapping.getByExternalId("ramp", args.rampId, "charge");
    if (mapped) {
      const existing = await tx
        .selectFrom("charge")
        .select(["id", "chargeId", "status"])
        .where("id", "=", mapped.entityId)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) {
        throw new Error("Mapped Ramp charge no longer exists");
      }
      // Coding belongs to Ramp until posting succeeds. Lock the same header
      // as the posting transaction so corrections cannot change a Posted row.
      if (existing.status === "Draft") {
        await tx
          .updateTable("charge")
          .set({ ...headerValues, updatedBy: args.actorId })
          .where("id", "=", existing.id)
          .where("companyId", "=", args.companyId)
          .execute();
        await tx
          .deleteFrom("chargeLine")
          .where("chargeId", "=", existing.id)
          .where("companyId", "=", args.companyId)
          .execute();
        if (lineValues.length > 0) {
          await tx
            .insertInto("chargeLine")
            .values(
              lineValues.map((line) => ({
                ...line,
                chargeId: existing.id
              }))
            )
            .execute();
        }
      }
      return {
        chargeId: existing.id,
        readableId: existing.chargeId,
        status: existing.status,
        created: false
      };
    }

    const sequence = args.readableId
      ? args.readableId
      : (
          await sql<{ get_next_sequence: string }>`
            SELECT get_next_sequence('charge', ${args.companyId}) as get_next_sequence
          `.execute(tx)
        ).rows[0]?.get_next_sequence;
    if (!sequence) {
      throw new Error("Failed to generate charge number");
    }

    const header = await tx
      .insertInto("charge")
      .values({
        chargeId: sequence,
        ...headerValues,
        status: "Draft",
        integration: "ramp",
        companyId: args.companyId,
        createdBy: args.actorId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    if (args.lines.length > 0) {
      await tx
        .insertInto("chargeLine")
        .values(
          lineValues.map((line) => ({
            ...line,
            chargeId: header.id
          }))
        )
        .execute();
    }

    await mapping.link("charge", header.id, "ramp", args.rampId, {
      createdBy: args.actorId
    });

    return {
      chargeId: header.id,
      readableId: sequence,
      status: "Draft",
      created: true
    };
  });
}
