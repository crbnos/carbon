import { fromDate, parseAbsolute } from "@internationalized/date";
import {
  createMappingService,
  type ExternalIntegrationMapping
} from "./external-mapping";
import {
  BaseEntitySyncer,
  type BatchSyncResult,
  type SyncResult,
  toSyncResultError
} from "./types";
import { withTriggersDisabled } from "./utils";

/** Mapping reads use node-postgres Date values; fixtures/API inputs use ISO strings. */
function syncInstant(value: string | Date) {
  return value instanceof Date
    ? fromDate(value, "UTC")
    : parseAbsolute(value, "UTC");
}

/** Posted card documents: persist each create before advancing the batch,
 * and apply native voids before the existing-mapping shortcut. Providers own the
 * remote retry identity and must prove deletion before this base tombstones it. */
export abstract class ChargeSyncerBase<
  TLocal extends { status: string; updatedAt: string | null },
  TRemote,
  TOmit extends keyof TRemote
> extends BaseEntitySyncer<TLocal, TRemote, TOmit> {
  /** QBO retains its timestamp-gated sparse updates; Xero is create-only. */
  protected readonly updateMappedCharges: boolean = false;
  protected abstract deleteRemote(remoteId: string): Promise<void>;
  protected abstract upsertRemote(
    data: Omit<TRemote, TOmit>,
    localId: string,
    existingRemoteId?: string | null
  ): Promise<string>;

  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (!this.config.enabled)
      return {
        status: "skipped",
        action: "none",
        localId: entityId,
        error: "Sync disabled in config"
      };
    try {
      const [localEntity, mapping] = await Promise.all([
        this.fetchLocal(entityId),
        this.mappingService.getByEntity(
          this.entityType,
          entityId,
          this.provider.id
        )
      ]);
      return this.pushLoadedToAccounting(entityId, localEntity, mapping);
    } catch (error) {
      return this.failedPush(entityId, error);
    }
  }

  /** One lifecycle for single and batch callers; never re-fetch a loaded row. */
  private async pushLoadedToAccounting(
    entityId: string,
    localEntity: TLocal | null | undefined,
    mapping: ExternalIntegrationMapping | null | undefined
  ): Promise<SyncResult> {
    try {
      if (!localEntity)
        throw new Error(`Entity ${entityId} not found in Carbon`);
      if (mapping?.externalId && localEntity.status === "Voided") {
        if (mapping.metadata?.voided !== true) {
          await this.deleteRemote(mapping.externalId);
          await withTriggersDisabled(this.database, async (tx) => {
            await createMappingService(tx, this.companyId).link(
              this.entityType,
              entityId,
              this.provider.id,
              mapping.externalId,
              { metadata: { ...mapping.metadata, voided: true } }
            );
          });
        }
        return {
          status: "success",
          action: "deleted",
          localId: entityId,
          remoteId: mapping.externalId
        };
      }
      if (mapping?.externalId && !this.updateMappedCharges) {
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          remoteId: mapping.externalId,
          error: "Card charge already pushed (idempotent)"
        };
      }
      if (localEntity.status === "Voided")
        throw new Error(
          "Cannot confirm card charge void without a durable remote identity; verify the provider transaction before resolving this operation"
        );
      const eligible = await this.shouldSync?.({
        direction: "push",
        localEntity,
        isFirstSync: !mapping,
        entityId
      });
      if (eligible !== true)
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          error:
            typeof eligible === "string"
              ? eligible
              : "Entity not eligible for sync"
        };
      if (
        mapping?.lastSyncedAt &&
        this.updateMappedCharges &&
        (!localEntity.updatedAt ||
          syncInstant(localEntity.updatedAt).compare(
            syncInstant(mapping.lastSyncedAt)
          ) <= 0)
      ) {
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          remoteId: mapping.externalId,
          error: "Already synced - local unchanged"
        };
      }
      const payload = await this.mapToRemote(localEntity);
      const remoteId = await this.upsertRemote(
        payload,
        entityId,
        mapping?.externalId ?? null
      );
      await withTriggersDisabled(this.database, (tx) =>
        this.linkEntities(tx, entityId, remoteId)
      );
      return {
        status: "success",
        action: mapping?.externalId ? "updated" : "created",
        localId: entityId,
        remoteId
      };
    } catch (error) {
      return this.failedPush(entityId, error);
    }
  }

  private failedPush(entityId: string, error: unknown): SyncResult {
    return {
      status: "error",
      action: "none",
      localId: entityId,
      error: toSyncResultError(error)
    };
  }

  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = [];
    if (!this.config.enabled) {
      results.push(
        ...entityIds.map(
          (localId): SyncResult => ({
            status: "skipped",
            action: "none",
            localId,
            error: "Sync disabled in config"
          })
        )
      );
    } else if (entityIds.length > 0) {
      try {
        const ids = [...new Set(entityIds)];
        const [localEntities, mappings] = await Promise.all([
          this.fetchLocalBatch(ids),
          this.mappingService.getByEntities(
            this.entityType,
            ids,
            this.provider.id
          )
        ]);
        const completed = new Map<string, SyncResult>();
        for (const id of entityIds) {
          const result =
            completed.get(id) ??
            (await this.pushLoadedToAccounting(
              id,
              localEntities.get(id),
              mappings.get(id)
            ));
          completed.set(id, result);
          results.push(result);
        }
      } catch (error) {
        results.push(...entityIds.map((id) => this.failedPush(id, error)));
      }
    }
    return {
      results,
      successCount: results.filter((r) => r.status === "success").length,
      errorCount: results.filter((r) => r.status === "error").length,
      skippedCount: results.filter((r) => r.status === "skipped").length
    };
  }
}
