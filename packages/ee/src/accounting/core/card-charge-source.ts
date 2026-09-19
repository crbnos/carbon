import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { fromDate } from "@internationalized/date";
import type { CardTransactionType } from "./posting";

export type CardChargeSource = {
  id: string;
  companyId: string;
  cardTransactionId: string;
  type: CardTransactionType;
  status: "Draft" | "Posted" | "Voided";
  supplierId: string | null;
  supplierExternalId: string | null;
  merchantName: string | null;
  memo: string | null;
  updatedAt: string | null;
};

/** node-postgres returns Date objects although generated DB types say string. */
function sourceTimestamp(value: string | Date | null): string | null {
  return value instanceof Date
    ? fromDate(value, "UTC").toAbsoluteString()
    : value;
}

/** One tenant-scoped query for headers and their provider vendor mappings. */
export async function loadCardChargeSources(
  database: Kysely<KyselyDatabase>,
  args: { ids: string[]; companyId: string; integration: string }
): Promise<Map<string, CardChargeSource>> {
  if (args.ids.length === 0) return new Map();
  const rows = await database
    .selectFrom("cardTransaction")
    .leftJoin("externalIntegrationMapping as mapping", (join) =>
      join
        .onRef("mapping.entityId", "=", "cardTransaction.supplierId")
        .onRef("mapping.companyId", "=", "cardTransaction.companyId")
        .on("mapping.integration", "=", args.integration)
        .on("mapping.entityType", "=", "vendor")
    )
    .select([
      "cardTransaction.id",
      "cardTransaction.companyId",
      "cardTransaction.cardTransactionId",
      "cardTransaction.type",
      "cardTransaction.status",
      "cardTransaction.supplierId",
      "cardTransaction.merchantName",
      "cardTransaction.memo",
      "cardTransaction.updatedAt",
      "mapping.externalId as supplierExternalId"
    ])
    .where("cardTransaction.id", "in", args.ids)
    .where("cardTransaction.companyId", "=", args.companyId)
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        ...row,
        type: row.type as CardTransactionType,
        status: row.status as CardChargeSource["status"],
        updatedAt: sourceTimestamp(row.updatedAt)
      }
    ])
  );
}
