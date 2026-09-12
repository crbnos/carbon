import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely, Transaction } from "kysely";

export type LoadDb = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

/**
 * The `externalIntegrationMapping.integration` value every NetSuite-sourced
 * record is filed under. It is what makes a re-run an UPDATE instead of a
 * duplicate, and what lets a migrated record be traced back to NetSuite years
 * later.
 */
export const NETSUITE_INTEGRATION = "netsuite";

/**
 * Carbon entity types this migration links. Kept as a closed union rather than
 * a bare string so a typo in one loader tier cannot silently create a mapping
 * namespace nothing else reads.
 */
export type MigrationEntityType =
  | "account"
  | "address"
  | "contact"
  | "currency"
  | "customer"
  | "customerContact"
  | "customerLocation"
  | "customerType"
  | "department"
  | "item"
  | "location"
  | "makeMethod"
  | "paymentTerm"
  | "purchaseOrder"
  | "purchaseOrderLine"
  | "salesOrder"
  | "salesOrderLine"
  | "shippingMethod"
  | "supplier"
  | "supplierContact"
  | "supplierLocation"
  | "supplierPart"
  | "supplierType"
  | "unitOfMeasure";

type MappingRow = {
  entityType: MigrationEntityType;
  entityId: string;
  externalId: string;
};

/**
 * NetSuite internal id → Carbon id, for one migration run.
 *
 * Seeded from the mappings a previous run left behind, then grown as tiers
 * insert rows. Held in memory for the whole run because every tier after the
 * first resolves its foreign keys through it — one lookup per order line
 * against the database would be an N+1 across the customer's entire order book.
 */
export class MigrationIdMap {
  private readonly resolved = new Map<string, string>();
  private readonly pending: MappingRow[] = [];

  private static key(
    entityType: MigrationEntityType,
    externalId: string
  ): string {
    return `${entityType}:${externalId}`;
  }

  get(
    entityType: MigrationEntityType,
    externalId: string | null | undefined
  ): string | undefined {
    if (!externalId) return undefined;
    return this.resolved.get(MigrationIdMap.key(entityType, externalId));
  }

  /** True when a previous run already created this record — the tier should UPDATE. */
  has(
    entityType: MigrationEntityType,
    externalId: string | null | undefined
  ): boolean {
    return this.get(entityType, externalId) !== undefined;
  }

  /**
   * Record a link. `persist: false` is for mappings read back from the database,
   * which are already stored — re-writing them would churn `updatedAt` on every
   * row of every re-run.
   */
  set(
    entityType: MigrationEntityType,
    externalId: string,
    entityId: string,
    options: { persist?: boolean } = {}
  ): void {
    this.resolved.set(MigrationIdMap.key(entityType, externalId), entityId);
    if (options.persist !== false)
      this.pending.push({ entityType, entityId, externalId });
  }

  takePending(): MappingRow[] {
    return this.pending.splice(0, this.pending.length);
  }

  get size(): number {
    return this.resolved.size;
  }
}

/** Seed the map from what previous runs linked, so a re-run updates in place. */
export async function readExistingMappings(
  db: LoadDb,
  companyId: string
): Promise<MigrationIdMap> {
  const map = new MigrationIdMap();

  const rows = await db
    .selectFrom("externalIntegrationMapping")
    .select(["entityType", "entityId", "externalId"])
    .where("integration", "=", NETSUITE_INTEGRATION)
    .where("companyId", "=", companyId)
    .execute();

  for (const row of rows) {
    if (!row.externalId || !row.entityId) continue;
    map.set(
      row.entityType as MigrationEntityType,
      row.externalId,
      row.entityId,
      {
        persist: false
      }
    );
  }

  return map;
}

const MAPPING_CHUNK_SIZE = 500;

/**
 * Persist the links this run created.
 *
 * The `.where()` on the conflict clause is not optional: the unique index it
 * arbitrates on is PARTIAL (`WHERE "allowDuplicateExternalId" = false`), and
 * Postgres refuses to infer a partial index without its predicate (42P10).
 */
export async function writeMappings(
  trx: LoadDb,
  args: { companyId: string; userId: string; rows: MappingRow[] }
): Promise<number> {
  const rows = args.rows.filter((row) => row.externalId && row.entityId);
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  let written = 0;

  for (let i = 0; i < rows.length; i += MAPPING_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + MAPPING_CHUNK_SIZE);
    await trx
      .insertInto("externalIntegrationMapping")
      .values(
        chunk.map((row) => ({
          entityType: row.entityType,
          entityId: row.entityId,
          integration: NETSUITE_INTEGRATION,
          externalId: row.externalId,
          allowDuplicateExternalId: false,
          companyId: args.companyId,
          createdBy: args.userId,
          createdAt: now,
          updatedAt: now,
          lastSyncedAt: now
        }))
      )
      .onConflict((oc) =>
        oc
          .columns(["integration", "externalId", "entityType", "companyId"])
          .where("allowDuplicateExternalId", "=", false)
          .doUpdateSet((eb) => ({
            entityId: eb.ref("excluded.entityId"),
            updatedAt: eb.ref("excluded.updatedAt"),
            lastSyncedAt: eb.ref("excluded.lastSyncedAt")
          }))
      )
      .execute();
    written += chunk.length;
  }

  return written;
}
