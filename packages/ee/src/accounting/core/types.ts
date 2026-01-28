import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type z from "zod";
import type { AccountingProvider } from "../providers";
import {
  createMappingService,
  type ExternalIntegrationMappingService
} from "./external-mapping";
import type {
  AccountingSyncSchema,
  BillLineSchema,
  BillSchema,
  ContactSchema,
  EmployeeSchema,
  InventoryAdjustmentSchema,
  ItemSchema,
  ProviderCredentialsSchema,
  ProviderID,
  ProviderIntegrationMetadataSchema,
  PurchaseOrderLineSchema,
  PurchaseOrderSchema,
  SalesInvoiceLineSchema,
  SalesInvoiceSchema,
  SalesOrderLineSchema,
  SalesOrderSchema,
  SyncDirectionSchema
} from "./models";
import { AccountingApiError, withTriggersDisabled } from "./utils";

// /********************************************************\
// *                  Provider Types Start                  *
// \********************************************************/
export type ProviderCredentials = z.output<typeof ProviderCredentialsSchema>;
export type ProviderIntegrationMetadata = z.infer<
  typeof ProviderIntegrationMetadataSchema
>;

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  accessToken?: string;
  refreshToken?: string;
  redirectUri?: string;
  getAuthUrl: (scopes: string[], redirectUri: string) => string;
  onTokenRefresh?: (creds: ProviderCredentials) => Promise<void>;
}

export interface AuthProvider {
  getCredentials(): ProviderCredentials;
  getAuthUrl(scopes: string[], redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<ProviderCredentials>;
  refresh(): Promise<ProviderCredentials>;
}

export type ProviderConfig<T = unknown> = {
  id: ProviderID;
  companyId: string;
  syncConfig: GlobalSyncConfig;
  onTokenRefresh?: OAuthClientOptions["onTokenRefresh"];
} & T;

export abstract class BaseProvider {
  static id: ProviderID;

  protected creds?: ProviderCredentials;
  public auth!: AuthProvider;

  abstract getSyncConfig<T extends AccountingEntityType>(
    entity: T
  ): GlobalSyncConfig["entities"][T];

  abstract validate(auth: ProviderCredentials): Promise<boolean>;

  abstract authenticate(...args: any[]): Promise<ProviderCredentials>;
}

// /********************************************************\
// *                   Provider Types End                   *
// \********************************************************/

// /********************************************************\
// *                    Sync Types Start                    *
// \********************************************************/

export type SyncDirection = z.infer<typeof SyncDirectionSchema>;

/**
 * Defines which system owns the data integrity.
 * - 'carbon': Carbon data overwrites Accounting data.
 * - 'accounting': Accounting data overwrites Carbon data.
 */
export type SystemOfRecord = "carbon" | "accounting";

// ============================================================================
// 2. CONFIGURATION INTERFACES
// ============================================================================

// Core domain types
export type AccountingEntityType =
  | "customer"
  | "vendor"
  | "item"
  | "employee"
  | "purchaseOrder"
  | "bill"
  | "salesOrder"
  | "invoice"
  | "payment"
  | "inventoryAdjustment";

export interface EntityConfig {
  /** Is this entity sync active? */
  enabled: boolean;

  /** Direction of sync. */
  direction: SyncDirection;

  /** In case of a data conflict, who wins? */
  owner: SystemOfRecord;

  /**
   * ISO Date string. Only sync records modified after this date.
   * Critical for initial setup to prevent syncing ancient history.
   */
  syncFromDate?: string;
}

export interface GlobalSyncConfig {
  /**
   * The configuration for each specific entity
   */
  entities: Record<AccountingEntityType, EntityConfig>;
}

export interface EntityDefinition {
  label: string;
  type: "master" | "transaction";
  dependsOn?: AccountingEntityType[];
  supportedDirections: SyncDirection[];
}

export type AccountingSyncPayload = z.infer<typeof AccountingSyncSchema>;

export type SyncFn = (input: {
  client: SupabaseClient<Database>;
  kysely: Kysely<KyselyDatabase>;
  entity: AccountingEntity;
  provider: AccountingProvider;
  payload: AccountingSyncPayload;
}) => Promise<any> | any;

export interface AccountingEntity<
  T extends AccountingEntityType = AccountingEntityType
> {
  entityType: T;
  entityId: string;
  operation: "create" | "update" | "delete" | "sync";
  lastSyncedAt?: string;
}

export interface SyncContext {
  database: Kysely<KyselyDatabase>;
  companyId: string;
  provider: AccountingProvider;
  config: EntityConfig;
  entityType: AccountingEntityType;
}

export interface SyncResult {
  status: "success" | "skipped" | "error";
  action: "created" | "updated" | "deleted" | "none";
  localId?: string;
  remoteId?: string;
  error?: unknown;
}

export interface BatchSyncResult {
  results: SyncResult[];
  successCount: number;
  errorCount: number;
  skippedCount: number;
}

/**
 * Context passed to the optional shouldSync method to determine
 * if an entity should be synced.
 */
export interface ShouldSyncContext<TLocal, TRemote> {
  /** Direction of the sync operation */
  direction: "push" | "pull";

  /** The local entity (available for push, and after mapping for pull) */
  localEntity?: TLocal;

  /** The remote entity (available for pull, before mapping) */
  remoteEntity?: TRemote;

  /** Whether this is a first-time sync (no existing mapping) */
  isFirstSync: boolean;

  /** The entity ID (local for push, remote for pull) */
  entityId: string;
}

export interface IEntitySyncer {
  // Single-item methods
  pushToAccounting(entityId: string): Promise<SyncResult>;
  pullFromAccounting(remoteId: string): Promise<SyncResult>;

  // Batch methods
  pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult>;
  pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult>;
}

export abstract class BaseEntitySyncer<
  TLocal, // Carbon DB Entity Type (e.g. Invoice)
  TRemote, // Accounting API Entity Type (e.g. Xero.Invoice)
  TOmit extends string | symbol | number // Fields to omit from mapping
> implements IEntitySyncer
{
  protected database: Kysely<KyselyDatabase>;
  protected companyId: string;
  protected provider: AccountingProvider;
  protected config: EntityConfig;
  protected entityType: AccountingEntityType;
  protected mappingService: ExternalIntegrationMappingService;

  constructor(protected context: SyncContext) {
    this.database = context.database;
    this.companyId = context.companyId;
    this.provider = context.provider;
    this.config = context.config;
    this.entityType = context.entityType;
    this.mappingService = createMappingService(
      context.database,
      context.companyId
    );
  }

  // =================================================================
  // 1. ID MAPPING (Default implementations using mapping service)
  // =================================================================

  /**
   * Look up the Remote ID (e.g. Xero ID) for a given Local ID (Carbon ID).
   * Default implementation uses the external integration mapping table.
   * Can be overridden by subclasses for custom behavior.
   */
  public async getRemoteId(localId: string): Promise<string | null> {
    return this.mappingService.getExternalId(
      this.entityType,
      localId,
      this.provider.id
    );
  }

  /**
   * Look up the Local ID (Carbon ID) for a given Remote ID (e.g. Xero ID).
   * Default implementation uses the external integration mapping table.
   * Can be overridden by subclasses for custom behavior.
   */
  public async getLocalId(remoteId: string): Promise<string | null> {
    return this.mappingService.getEntityId(
      this.provider.id,
      remoteId,
      this.entityType
    );
  }

  /**
   * Save the link between a Carbon ID and a Remote ID.
   * Default implementation uses the external integration mapping table.
   * Can be overridden by subclasses for custom behavior.
   */
  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    // Create a mapping service with the transaction
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      this.entityType,
      localId,
      this.provider.id,
      remoteId,
      { remoteUpdatedAt }
    );
  }

  protected abstract fetchLocal(id: string): Promise<TLocal | null>;

  protected abstract fetchRemote(id: string): Promise<TRemote | null>;

  protected abstract mapToRemote(local: TLocal): Promise<Omit<TRemote, TOmit>>;

  protected abstract mapToLocal(remote: TRemote): Promise<Partial<TLocal>>;

  /**
   * Extract the last updated timestamp from a remote entity.
   * Used to compare with local entity to avoid unnecessary updates.
   */
  protected abstract getRemoteUpdatedAt(remote: TRemote): Date | null;

  protected abstract upsertLocal(
    tx: KyselyTx,
    data: Partial<TLocal>,
    remoteId: string
  ): Promise<string>;

  protected abstract upsertRemote(
    data: Omit<TRemote, TOmit>,
    localId: string
  ): Promise<string>;

  // =================================================================
  // 2. ABSTRACT BATCH METHODS (Implemented by Subclasses)
  // =================================================================

  /**
   * Fetch multiple local entities by their IDs.
   * Returns a Map of localId -> entity.
   */
  protected abstract fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, TLocal>>;

  /**
   * Fetch multiple remote entities by their IDs.
   * Returns a Map of remoteId -> entity.
   */
  protected abstract fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, TRemote>>;

  /**
   * Upsert multiple remote entities in a single API call.
   * Returns a Map of localId -> remoteId.
   */
  protected abstract upsertRemoteBatch(
    data: Array<{ localId: string; payload: Omit<TRemote, TOmit> }>
  ): Promise<Map<string, string>>;

  /**
   * Optional method to determine if an entity should be synced.
   * Override this in subclasses to implement business logic like
   * "only sync posted invoices" or "don't sync archived items".
   *
   * @param context - Context about the sync operation including direction,
   *                  the entity being synced, and whether it's a first sync
   * @returns true to proceed with sync, false to skip silently,
   *          or a string with a reason to skip
   */
  protected shouldSync?(
    context: ShouldSyncContext<TLocal, TRemote>
  ): boolean | string | Promise<boolean | string>;

  // =================================================================
  // 3. PUSH WORKFLOW (Carbon -> Accounting)
  // =================================================================

  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (!this.config.enabled) {
      return {
        status: "skipped",
        action: "none",
        error: "Sync disabled in config"
      };
    }

    try {
      // 1. Check if already linked
      const existingMapping = await this.mappingService.getByEntity(
        this.entityType,
        entityId,
        this.provider.id
      );

      // 2. Fetch local entity
      const localEntity = await this.fetchLocal(entityId);
      if (!localEntity) {
        return {
          status: "error",
          action: "none",
          error: `Entity ${entityId} not found in Carbon`
        };
      }

      // 3. Check if entity should be synced (optional business logic)
      if (this.shouldSync) {
        const shouldSyncResult = await this.shouldSync({
          direction: "push",
          localEntity,
          isFirstSync: !existingMapping,
          entityId
        });

        if (shouldSyncResult !== true) {
          return {
            status: "skipped",
            action: "none",
            localId: entityId,
            error:
              typeof shouldSyncResult === "string"
                ? shouldSyncResult
                : "Entity not eligible for sync"
          };
        }
      }

      const localUpdatedAt = new Date((localEntity as any).updatedAt);

      // 4. FAST BAILOUT: If already synced and local hasn't changed
      if (existingMapping?.lastSyncedAt) {
        if (localUpdatedAt <= new Date(existingMapping.lastSyncedAt)) {
          return {
            status: "skipped",
            action: "none",
            localId: entityId,
            remoteId: existingMapping.externalId,
            error: "Already synced - local unchanged"
          };
        }
      }

      // 5. Map and push
      const remotePayload = await this.mapToRemote(localEntity);
      const id = await this.upsertRemote(remotePayload, entityId);

      // 6. Update mapping
      const remoteId = await withTriggersDisabled(this.database, async (tx) => {
        await this.linkEntities(tx, entityId, id);
        return id;
      });

      await this.logSyncOperation("push", entityId, remoteId, "success");

      return {
        status: "success",
        action: existingMapping ? "updated" : "created",
        localId: entityId,
        remoteId
      };
    } catch (err: any) {
      await this.logSyncOperation("push", entityId, undefined, "error", err);
      return {
        status: "error",
        action: "none",
        localId: entityId,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // =================================================================
  // 4. PULL WORKFLOW (Accounting -> Carbon)
  // =================================================================

  async pullFromAccounting(remoteId: string): Promise<SyncResult> {
    if (!this.config.enabled) {
      return {
        status: "skipped",
        action: "none",
        error: "Sync disabled in config"
      };
    }

    try {
      // 1. Check mapping table FIRST (fast, indexed lookup)
      const existingMapping = await this.mappingService.getByExternalId(
        this.provider.id,
        remoteId,
        this.entityType
      );

      // 2. Fetch remote entity
      const remoteEntity = await this.fetchRemote(remoteId);
      if (!remoteEntity) {
        return {
          status: "error",
          action: "none",
          error: `Entity ${remoteId} not found in Remote`
        };
      }

      // 3. Check if entity should be synced (optional business logic)
      if (this.shouldSync) {
        const shouldSyncResult = await this.shouldSync({
          direction: "pull",
          remoteEntity,
          isFirstSync: !existingMapping,
          entityId: remoteId
        });

        if (shouldSyncResult !== true) {
          return {
            status: "skipped",
            action: "none",
            remoteId,
            error:
              typeof shouldSyncResult === "string"
                ? shouldSyncResult
                : "Entity not eligible for sync"
          };
        }
      }

      const remoteUpdatedAt = this.getRemoteUpdatedAt(remoteEntity);

      // 4. FAST BAILOUT: Compare timestamps without fetching local entity
      if (existingMapping?.remoteUpdatedAt && remoteUpdatedAt) {
        if (new Date(existingMapping.remoteUpdatedAt) >= remoteUpdatedAt) {
          return {
            status: "skipped",
            action: "none",
            localId: existingMapping.entityId,
            remoteId,
            error: "Already synced - remote unchanged"
          };
        }
      }

      // 5. Map and upsert (only if needed)
      const localPayload = await this.mapToLocal(remoteEntity);

      // Wrap DB writes in withTriggersDisabled to prevent circular triggers
      // (external sync -> DB write -> trigger -> sync back to external)
      const newLocalId = await withTriggersDisabled(
        this.database,
        async (tx) => {
          const id = await this.upsertLocal(tx, localPayload, remoteId);
          await this.linkEntities(
            tx,
            id,
            remoteId,
            remoteUpdatedAt ?? undefined
          );

          return id;
        }
      );

      await this.logSyncOperation("pull", newLocalId, remoteId, "success");

      return {
        status: "success",
        action: existingMapping ? "updated" : "created",
        localId: newLocalId,
        remoteId
      };
    } catch (err: any) {
      await this.logSyncOperation("pull", undefined, remoteId, "error", err);
      return {
        status: "error",
        action: "none",
        remoteId,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // =================================================================
  // 5. BATCH PUSH WORKFLOW (Carbon -> Accounting)
  // =================================================================

  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = [];

    if (!this.config.enabled) {
      for (const id of entityIds) {
        results.push({
          status: "skipped",
          action: "none",
          localId: id,
          error: "Sync disabled in config"
        });
      }
      return this.summarizeBatchResults(results);
    }

    try {
      // 1. Fetch all local entities in batch
      const localEntities = await this.fetchLocalBatch(entityIds);

      // Track entities not found locally
      const notFoundIds = entityIds.filter((id) => !localEntities.has(id));
      for (const id of notFoundIds) {
        results.push({
          status: "error",
          action: "none",
          localId: id,
          error: `Entity ${id} not found in Carbon`
        });
      }

      // 2. Check shouldSync and map all found entities to remote payloads
      const batchPayloads: Array<{
        localId: string;
        payload: Omit<TRemote, TOmit>;
      }> = [];

      for (const [localId, entity] of localEntities) {
        try {
          // Check if entity should be synced (optional business logic)
          if (this.shouldSync) {
            const shouldSyncResult = await this.shouldSync({
              direction: "push",
              localEntity: entity,
              isFirstSync: true, // Batch doesn't check existing mappings for perf
              entityId: localId
            });

            if (shouldSyncResult !== true) {
              results.push({
                status: "skipped",
                action: "none",
                localId,
                error:
                  typeof shouldSyncResult === "string"
                    ? shouldSyncResult
                    : "Entity not eligible for sync"
              });
              continue;
            }
          }

          const payload = await this.mapToRemote(entity);
          batchPayloads.push({ localId, payload });
        } catch (err) {
          results.push({
            status: "error",
            action: "none",
            localId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      if (batchPayloads.length === 0) {
        return this.summarizeBatchResults(results);
      }

      // 3. Upsert all in a single batch call
      const remoteIdMap = await this.upsertRemoteBatch(batchPayloads);

      // 4. Link entities using batch operation
      const mappingsToLink: Array<{
        entityType: string;
        entityId: string;
        integration: string;
        externalId: string;
      }> = [];

      for (const { localId } of batchPayloads) {
        const remoteId = remoteIdMap.get(localId);
        if (remoteId) {
          mappingsToLink.push({
            entityType: this.entityType,
            entityId: localId,
            integration: this.provider.id,
            externalId: remoteId
          });
          results.push({
            status: "success",
            action: "updated",
            localId,
            remoteId
          });
        } else {
          results.push({
            status: "error",
            action: "none",
            localId,
            error: "Remote upsert did not return ID"
          });
        }
      }

      if (mappingsToLink.length > 0) {
        await withTriggersDisabled(this.database, async (tx) => {
          const txMappingService = createMappingService(tx, this.companyId);
          await txMappingService.linkBatch(mappingsToLink);
        });
      }
    } catch (err: any) {
      // If the whole batch fails, mark all as errors
      for (const id of entityIds) {
        if (!results.find((r) => r.localId === id)) {
          results.push({
            status: "error",
            action: "none",
            localId: id,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }

    return this.summarizeBatchResults(results);
  }

  // =================================================================
  // 6. BATCH PULL WORKFLOW (Accounting -> Carbon)
  // =================================================================

  async pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = [];

    if (!this.config.enabled) {
      for (const id of remoteIds) {
        results.push({
          status: "skipped",
          action: "none",
          remoteId: id,
          error: "Sync disabled in config"
        });
      }
      return this.summarizeBatchResults(results);
    }

    try {
      // 1. Fetch all remote entities in batch
      const remoteEntities = await this.fetchRemoteBatch(remoteIds);

      // Track entities not found remotely
      const notFoundIds = remoteIds.filter((id) => !remoteEntities.has(id));
      for (const id of notFoundIds) {
        results.push({
          status: "error",
          action: "none",
          remoteId: id,
          error: `Entity ${id} not found in Remote`
        });
      }

      // 2. Process each found entity
      for (const [remoteId, entity] of remoteEntities) {
        try {
          // Check system of record
          const existingLocalId = await this.getLocalId(remoteId);
          if (existingLocalId && this.config.owner === "carbon") {
            results.push({
              status: "skipped",
              action: "none",
              remoteId,
              localId: existingLocalId,
              error: "Carbon is System of Record"
            });
            continue;
          }

          // Check if entity should be synced (optional business logic)
          if (this.shouldSync) {
            const shouldSyncResult = await this.shouldSync({
              direction: "pull",
              remoteEntity: entity,
              isFirstSync: !existingLocalId,
              entityId: remoteId
            });

            if (shouldSyncResult !== true) {
              results.push({
                status: "skipped",
                action: "none",
                remoteId,
                error:
                  typeof shouldSyncResult === "string"
                    ? shouldSyncResult
                    : "Entity not eligible for sync"
              });
              continue;
            }
          }

          // Map and upsert locally
          const localPayload = await this.mapToLocal(entity);

          const localId = await withTriggersDisabled(
            this.database,
            async (tx) => {
              const id = await this.upsertLocal(tx, localPayload, remoteId);

              await this.linkEntities(tx, id, remoteId);

              return id;
            }
          );

          results.push({
            status: "success",
            action: "updated",
            localId,
            remoteId
          });
        } catch (err) {
          results.push({
            status: "error",
            action: "none",
            remoteId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    } catch (err: any) {
      // If the whole batch fails, mark all as errors
      for (const id of remoteIds) {
        if (!results.find((r) => r.remoteId === id)) {
          results.push({
            status: "error",
            action: "none",
            remoteId: id,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }

    return this.summarizeBatchResults(results);
  }

  private summarizeBatchResults(results: SyncResult[]): BatchSyncResult {
    return {
      results,
      successCount: results.filter((r) => r.status === "success").length,
      errorCount: results.filter((r) => r.status === "error").length,
      skippedCount: results.filter((r) => r.status === "skipped").length
    };
  }

  // =================================================================
  // 7. DEPENDENCY HELPER
  // =================================================================

  /**
   * JIT (Just-In-Time) Dependency Sync.
   * Finds the Remote ID for a related entity. If not synced, it syncs it.
   */
  protected async ensureDependencySynced(
    type: AccountingEntityType,
    localId: string
  ): Promise<string> {
    console.log(`[BaseSyncer] Resolving dependency: ${type} ${localId}`);

    // 1. Instantiate the dependency's Syncer
    // Dynamic import to avoid circular dependency
    const { SyncFactory } = await import("./sync");

    // Get sync config for the dependency, with a fallback to enabled by default
    const dependencyConfig = this.context.provider.getSyncConfig(type) ?? {
      enabled: true,
      direction: "two-way" as const,
      owner: "carbon" as const
    };

    const syncer = SyncFactory.getSyncer({
      ...this.context,
      config: dependencyConfig,
      entityType: type
    });

    // 2. Check if it's already synced (using the dependency's own logic)
    // Note: This requires getRemoteId to be exposed on the syncer instance
    const existingRemoteId = await (syncer as any).getRemoteId(localId);
    if (existingRemoteId) {
      console.log(
        `[BaseSyncer] Dependency ${type} ${localId} already synced: ${existingRemoteId}`
      );
      return existingRemoteId;
    }

    console.log(
      `[BaseSyncer] Dependency not found. Triggering sync for ${type} ${localId}`
    );

    // 3. Force a Push
    const result = await syncer.pushToAccounting(localId);

    if (result.status === "skipped") {
      throw new Error(
        `Dependency sync skipped for ${type} ${localId}: ${
          result.error ?? "Sync disabled in config"
        }`
      );
    }

    if (result.status === "error" || !result.remoteId) {
      throw new Error(
        `Dependency failed: Could not sync ${type} ${localId}. Error: ${
          result.error ?? "No remote ID returned"
        }`
      );
    }

    console.log(
      `[BaseSyncer] Dependency ${type} ${localId} synced successfully: ${result.remoteId}`
    );
    return result.remoteId;
  }

  // =================================================================
  // 6. LOGGING
  // =================================================================

  private async logSyncOperation(
    direction: "push" | "pull",
    localId: string | undefined,
    remoteId: string | undefined,
    status: "success" | "error",
    error?: unknown
  ) {
    const logEntry = {
      direction: direction.toUpperCase(),
      entity: this.getEntityTypeName(),
      localId,
      remoteId,
      status
    };

    if (status === "success") {
      console.log("[SyncLog]", logEntry);
    } else {
      // Enhanced error logging with structured details
      const errorDetails: Record<string, unknown> = { ...logEntry };

      if (error instanceof AccountingApiError) {
        errorDetails.errorType = error.name;
        errorDetails.provider = error.provider;
        errorDetails.operation = error.operation;
        errorDetails.apiDetails = {
          statusCode: error.details.statusCode,
          statusText: error.details.statusText,
          providerErrorType: error.details.providerErrorType,
          providerErrorCode: error.details.providerErrorCode,
          providerMessage: error.details.providerMessage,
          validationErrors: error.details.validationErrors
        };
        errorDetails.userMessage = error.getUserMessage();
      } else if (error instanceof Error) {
        errorDetails.errorType = error.name;
        errorDetails.errorMessage = error.message;
        errorDetails.stack = error.stack;
      } else {
        errorDetails.error = error;
      }

      console.error("[SyncLog] ERROR", errorDetails);
    }
  }

  private getEntityTypeName(): string {
    return (this.context as any).entityType || "unknown";
  }
}

// /********************************************************\
// *                     Sync Types End                     *
// \********************************************************/

export namespace Accounting {
  export type Contact = z.infer<typeof ContactSchema>;
  export type Employee = z.infer<typeof EmployeeSchema>;
  export type Item = z.infer<typeof ItemSchema>;
  export type Bill = z.infer<typeof BillSchema>;
  export type BillLine = z.infer<typeof BillLineSchema>;
  export type SalesInvoice = z.infer<typeof SalesInvoiceSchema>;
  export type SalesInvoiceLine = z.infer<typeof SalesInvoiceLineSchema>;
  export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
  export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;
  export type InventoryAdjustment = z.infer<typeof InventoryAdjustmentSchema>;
  export type SalesOrder = z.infer<typeof SalesOrderSchema>;
  export type SalesOrderLine = z.infer<typeof SalesOrderLineSchema>;
}

export interface RequestContext {
  auth?: ProviderCredentials;
  signal?: AbortSignal;
}

export interface SyncOptions {
  modifiedSince?: Date;
  cursor?: string;
  limit?: number;
  includeDeleted?: boolean;
}

export interface ReadableResource<T> {
  list(options?: SyncOptions): Promise<T[]>;
  get(id: string): Promise<T>;
}

export type WritableResource<T, Create, Update> = {
  create(data: Create): Promise<T>;
  update(id: string, data: Update): Promise<T>;
  upsert(...data: Array<Update & { id: string }>): Promise<T>;
  delete(id: string): Promise<void>;
};

export type Resource<T, Create, Update = Create> = ReadableResource<T> &
  WritableResource<T, Create, Update>;
