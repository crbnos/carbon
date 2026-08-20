import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";

export interface ExternalIntegrationMapping {
  id: string;
  entityType: string;
  entityId: string;
  integration: string;
  externalId: string;
  allowDuplicateExternalId: boolean;
  companyId: string;
  metadata: Record<string, unknown> | null;
  lastSyncedAt: string | null;
  remoteUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface LinkOptions {
  metadata?: Record<string, unknown>;
  remoteUpdatedAt?: Date | string;
  createdBy?: string;
  /**
   * When true, allows multiple Carbon entities to map to the same external ID.
   * Use this for many-to-one (Carbon to External) relationships.
   * Default: false (enforces unique external IDs per integration per company)
   */
  allowDuplicateExternalId?: boolean;
}

/**
 * Service for managing external integration mappings.
 * Provides a clean interface for linking Carbon entities to external system entities.
 */
export class ExternalIntegrationMappingService {
  constructor(
    private db: Kysely<KyselyDatabase> | KyselyTx,
    private companyId: string
  ) {}

  /**
   * Link a Carbon entity to an external system entity.
   * Uses upsert to handle both create and update cases.
   * If remoteUpdatedAt is not provided, it defaults to the current timestamp.
   */
  async link(
    entityType: string,
    entityId: string,
    integration: string,
    externalId: string,
    options?: LinkOptions
  ): Promise<void> {
    const now = new Date().toISOString();
    // Default to current timestamp if remoteUpdatedAt is not provided
    const remoteUpdatedAt =
      options?.remoteUpdatedAt instanceof Date
        ? options.remoteUpdatedAt.toISOString()
        : (options?.remoteUpdatedAt ?? now);
    const allowDuplicateExternalId = options?.allowDuplicateExternalId ?? false;

    await this.db
      .insertInto("externalIntegrationMapping")
      .values({
        entityType,
        entityId,
        integration,
        externalId,
        allowDuplicateExternalId,
        companyId: this.companyId,
        metadata: options?.metadata ?? null,
        lastSyncedAt: now,
        remoteUpdatedAt,
        createdBy: options?.createdBy ?? null,
        createdAt: now,
        updatedAt: now
      } as any)
      .onConflict((oc) =>
        oc
          .columns(["entityType", "entityId", "integration", "companyId"])
          .doUpdateSet({
            externalId,
            allowDuplicateExternalId,
            metadata: (options?.metadata ?? null) as any,
            lastSyncedAt: now,
            remoteUpdatedAt,
            updatedAt: now
          })
      )
      .execute();
  }

  /**
   * Unlink a Carbon entity from an external system.
   */
  async unlink(
    entityType: string,
    entityId: string,
    integration: string
  ): Promise<void> {
    await this.db
      .deleteFrom("externalIntegrationMapping")
      .where("entityType", "=", entityType)
      .where("entityId", "=", entityId)
      .where("integration", "=", integration)
      .where("companyId", "=", this.companyId)
      .execute();
  }

  /**
   * Get the external ID for a Carbon entity.
   */
  async getExternalId(
    entityType: string,
    entityId: string,
    integration: string
  ): Promise<string | null> {
    const mapping = await this.db
      .selectFrom("externalIntegrationMapping")
      .select("externalId")
      .where("entityType", "=", entityType)
      .where("entityId", "=", entityId)
      .where("integration", "=", integration)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    return mapping?.externalId ?? null;
  }

  /**
   * Get the Carbon entity ID for an external ID.
   */
  async getEntityId(
    integration: string,
    externalId: string,
    entityType?: string
  ): Promise<string | null> {
    let query = this.db
      .selectFrom("externalIntegrationMapping")
      .select("entityId")
      .where("integration", "=", integration)
      .where("externalId", "=", externalId)
      .where("companyId", "=", this.companyId);

    if (entityType) {
      query = query.where("entityType", "=", entityType);
    }

    const mapping = await query.executeTakeFirst();
    return mapping?.entityId ?? null;
  }

  /**
   * Get the full mapping for a Carbon entity.
   */
  async getByEntity(
    entityType: string,
    entityId: string,
    integration: string
  ): Promise<ExternalIntegrationMapping | null> {
    const mapping = await this.db
      .selectFrom("externalIntegrationMapping")
      .selectAll()
      .where("entityType", "=", entityType)
      .where("entityId", "=", entityId)
      .where("integration", "=", integration)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    return (mapping as ExternalIntegrationMapping) ?? null;
  }

  /**
   * Get the full mapping for an external ID.
   */
  async getByExternalId(
    integration: string,
    externalId: string,
    entityType?: string
  ): Promise<ExternalIntegrationMapping | null> {
    let query = this.db
      .selectFrom("externalIntegrationMapping")
      .selectAll()
      .where("integration", "=", integration)
      .where("externalId", "=", externalId)
      .where("companyId", "=", this.companyId);

    if (entityType) {
      query = query.where("entityType", "=", entityType);
    }

    const mapping = await query.executeTakeFirst();
    return (mapping as ExternalIntegrationMapping) ?? null;
  }

  /**
   * Get all mappings for a Carbon entity (across all integrations).
   */
  async getAllByEntity(
    entityType: string,
    entityId: string
  ): Promise<ExternalIntegrationMapping[]> {
    const mappings = await this.db
      .selectFrom("externalIntegrationMapping")
      .selectAll()
      .where("entityType", "=", entityType)
      .where("entityId", "=", entityId)
      .where("companyId", "=", this.companyId)
      .execute();

    return mappings as ExternalIntegrationMapping[];
  }

  /**
   * Get all mappings for an integration.
   */
  async getAllByIntegration(
    integration: string,
    entityType?: string
  ): Promise<ExternalIntegrationMapping[]> {
    let query = this.db
      .selectFrom("externalIntegrationMapping")
      .selectAll()
      .where("integration", "=", integration)
      .where("companyId", "=", this.companyId);

    if (entityType) {
      query = query.where("entityType", "=", entityType);
    }

    const mappings = await query.execute();
    return mappings as ExternalIntegrationMapping[];
  }

  /**
   * Check if a mapping already exists and is up to date.
   * Returns true if the mapping exists and remoteUpdatedAt >= the provided timestamp.
   */
  async isUpToDate(
    integration: string,
    externalId: string,
    remoteUpdatedAt: Date
  ): Promise<boolean> {
    const mapping = await this.getByExternalId(integration, externalId);

    if (!mapping?.remoteUpdatedAt) {
      return false;
    }

    return new Date(mapping.remoteUpdatedAt) >= remoteUpdatedAt;
  }

  /**
   * Get entity IDs that don't have a mapping for a specific integration.
   * Useful for finding entities that need to be synced.
   */
  async getUnsyncedEntityIds(
    entityType: string,
    tableName: string,
    integration: string,
    limit: number
  ): Promise<string[]> {
    const result = await (this.db as any)
      .selectFrom(tableName)
      .leftJoin("externalIntegrationMapping as m", (join: any) =>
        join
          .onRef("m.entityId", "=", `${tableName}.id`)
          .on("m.entityType", "=", entityType)
          .on("m.integration", "=", integration)
          .on("m.companyId", "=", this.companyId)
      )
      .select([`${tableName}.id`])
      .where(`${tableName}.companyId`, "=", this.companyId)
      .where("m.id", "is", null)
      .limit(limit)
      .execute();

    return (result as Array<{ id: string }>).map((r) => r.id);
  }

  /**
   * Update only the lastSyncedAt timestamp for a mapping.
   */
  async touchLastSyncedAt(
    entityType: string,
    entityId: string,
    integration: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .updateTable("externalIntegrationMapping")
      .set({
        lastSyncedAt: now,
        updatedAt: now,
        ...(remoteUpdatedAt
          ? { remoteUpdatedAt: remoteUpdatedAt.toISOString() }
          : {})
      })
      .where("entityType", "=", entityType)
      .where("entityId", "=", entityId)
      .where("integration", "=", integration)
      .where("companyId", "=", this.companyId)
      .execute();
  }

  /**
   * Batch link multiple entities to external IDs.
   * If remoteUpdatedAt is not provided for a mapping, it defaults to the current timestamp.
   */
  async linkBatch(
    mappings: Array<{
      entityType: string;
      entityId: string;
      integration: string;
      externalId: string;
      options?: LinkOptions;
    }>
  ): Promise<void> {
    if (mappings.length === 0) return;

    const now = new Date().toISOString();

    const values = mappings.map((m) => ({
      entityType: m.entityType,
      entityId: m.entityId,
      integration: m.integration,
      externalId: m.externalId,
      allowDuplicateExternalId: m.options?.allowDuplicateExternalId ?? false,
      companyId: this.companyId,
      metadata: m.options?.metadata ?? null,
      lastSyncedAt: now,
      // Default to current timestamp if remoteUpdatedAt is not provided
      remoteUpdatedAt:
        m.options?.remoteUpdatedAt instanceof Date
          ? m.options.remoteUpdatedAt.toISOString()
          : (m.options?.remoteUpdatedAt ?? now),
      createdBy: m.options?.createdBy ?? null,
      createdAt: now,
      updatedAt: now
    }));

    await this.db
      .insertInto("externalIntegrationMapping")
      .values(values as any)
      .onConflict((oc) =>
        oc
          .columns(["entityType", "entityId", "integration", "companyId"])
          .doUpdateSet((eb) => ({
            externalId: eb.ref("excluded.externalId"),
            allowDuplicateExternalId: eb.ref(
              "excluded.allowDuplicateExternalId"
            ),
            metadata: eb.ref("excluded.metadata"),
            lastSyncedAt: eb.ref("excluded.lastSyncedAt"),
            remoteUpdatedAt: eb.ref("excluded.remoteUpdatedAt"),
            updatedAt: eb.ref("excluded.updatedAt")
          }))
      )
      .execute();
  }
}

/**
 * Create a new ExternalIntegrationMappingService instance.
 */
export function createMappingService(
  db: Kysely<KyselyDatabase> | KyselyTx,
  companyId: string
): ExternalIntegrationMappingService {
  return new ExternalIntegrationMappingService(db, companyId);
}
