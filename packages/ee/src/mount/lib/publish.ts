import { datetime } from "@carbon/utils";
import {
  type CarbonCompanyRecord,
  type CarbonItemRecord,
  MissingIdentifierError,
  mapCustomerToMountCompany,
  mapItemToMountObject,
  mapSupplierToMountCompany
} from "./mappers";
import {
  type MountApiPort,
  type MountMappingPort,
  type PushOutcome,
  pushCompanyToMount,
  pushItemToMount
} from "./push";
import { MOUNT_INTEGRATION_ID } from "./service";
import type { MountEntityType } from "./types";

/**
 * The publish sweep: find Carbon records Mount does not have (or has stale),
 * and push them one at a time.
 *
 * This is deliberately the WHOLE delivery mechanism rather than a repair pass
 * behind an event stream. A record that fails is simply still stale on the
 * next run, so the sweep is its own retry and there is no operation ledger to
 * keep truthful. Mount documents no rate limit — the spec has no 429, no
 * Retry-After and in fact no non-200 response at all — so pushing serially
 * under a per-run cap keeps the call rate ours to control rather than a
 * function of how busy the shop floor is.
 *
 * Today it is driven by the buttons on the integration's detail page. A cron
 * is a second caller of this same function, per active integration.
 */

export type PublishableCustomer = CarbonCompanyRecord & { id: string };
export type PublishableSupplier = CarbonCompanyRecord & { id: string };
export type PublishablePart = CarbonItemRecord & { id: string };

export type MountPublishSource = {
  listStale(
    entityType: MountEntityType,
    limit: number,
    deferIds?: string[]
  ): Promise<
    Array<PublishableCustomer | PublishableSupplier | PublishablePart>
  >;
};

export type MountPublishSettings = {
  partDefinitionId?: string | null;
  customerTypeId?: string | null;
  supplierTypeId?: string | null;
};

export type MountPublishSummary = {
  entityType: MountEntityType;
  created: number;
  updated: number;
  ambiguous: Array<{ entityId: string; identifier: string; matches: number }>;
  failed: Array<{ entityId: string; reason: string }>;
  more: boolean;
  deferred: string[];
};

export const MOUNT_PUBLISH_BATCH_SIZE = 200;

export async function publishEntityType(
  source: MountPublishSource,
  mappings: MountMappingPort,
  api: MountApiPort,
  companyId: string,
  entityType: MountEntityType,
  settings: MountPublishSettings,
  limit: number = MOUNT_PUBLISH_BATCH_SIZE,
  deferIds: string[] = []
): Promise<MountPublishSummary> {
  const summary: MountPublishSummary = {
    entityType,
    created: 0,
    updated: 0,
    ambiguous: [],
    failed: [],
    more: false,
    deferred: deferIds
  };

  if (entityType === "item" && !settings.partDefinitionId) {
    // Without a definition there is no register to write into. Fail the run
    // rather than creating one — planting a register in someone's tenant is
    // not a side effect of pressing Publish.
    summary.failed.push({
      entityId: "*",
      reason:
        "No Mount part object definition configured. Set one in the integration settings."
    });
    return summary;
  }

  const readAt = datetime.timestamp();
  const records = await source.listStale(entityType, limit + 1, deferIds);
  const batch = records.slice(0, limit);
  const deferSet = new Set(deferIds);
  const overflow = records[limit];

  // Deferred records sort last, so a deferred record in the overflow slot
  // means everything else fit. Reporting `more` then would ask the user to
  // push again for records that are only going to fail again.
  summary.more = overflow !== undefined && !deferSet.has(overflow.id);

  for (const record of batch) {
    try {
      const outcome = await publishOne(
        api,
        mappings,
        companyId,
        entityType,
        record,
        settings,
        readAt
      );

      if (outcome.status === "created") summary.created++;
      else if (outcome.status === "updated") summary.updated++;
      else if (outcome.status === "ambiguous") {
        summary.ambiguous.push({
          entityId: record.id,
          identifier: outcome.identifier,
          matches: outcome.matches
        });
      }
    } catch (error) {
      // One bad record must not end the run — the other 199 are fine, and a
      // record that failed is still stale next time.
      summary.failed.push({
        entityId: record.id,
        reason:
          error instanceof MissingIdentifierError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown error"
      });
    }
  }

  const blocked = new Set([
    ...summary.failed.map((f) => f.entityId).filter((id) => id !== "*"),
    ...summary.ambiguous.map((a) => a.entityId)
  ]);

  // When the whole stale set fit in this run, anything not re-failed has
  // published or stopped being stale. Otherwise carry forward the deferred
  // records the cap kept this run from reaching.
  if (overflow !== undefined) {
    const attempted = new Set(batch.map((record) => record.id));
    for (const id of deferIds) {
      if (!attempted.has(id)) blocked.add(id);
    }
  }

  summary.deferred = [...blocked];

  return summary;
}

async function publishOne(
  api: MountApiPort,
  mappings: MountMappingPort,
  companyId: string,
  entityType: MountEntityType,
  record: PublishableCustomer | PublishableSupplier | PublishablePart,
  settings: MountPublishSettings,
  readAt: string
): Promise<PushOutcome> {
  if (entityType === "item") {
    return await pushItemToMount(
      mappings,
      api,
      companyId,
      record.id,
      mapItemToMountObject(
        record as PublishablePart,
        // Checked by the caller before the loop.
        settings.partDefinitionId as string
      ),
      readAt
    );
  }

  const input =
    entityType === "customer"
      ? mapCustomerToMountCompany(
          record as PublishableCustomer,
          settings.customerTypeId
        )
      : mapSupplierToMountCompany(
          record as PublishableSupplier,
          settings.supplierTypeId
        );

  return await pushCompanyToMount(
    mappings,
    api,
    companyId,
    entityType,
    record.id,
    input,
    readAt
  );
}

export { MOUNT_INTEGRATION_ID };
