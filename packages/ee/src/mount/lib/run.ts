// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMappingService } from "../../accounting/core/external-mapping";
import { patchIntegrationState } from "../../integrations/secrets";
import { getMountClient } from "./client";
import { MOUNT_INTEGRATION_ID } from "./constants";
import {
  applyBatchToRecord,
  failPublishRecord,
  isFinalBatch,
  type MountPublishRun,
  startPublishRecord
} from "./outcome";
import {
  describeMountHas,
  MOUNT_PUBLISH_BATCH_SIZE,
  type MountPublishSettings,
  matchCompanyType,
  publishEntityType
} from "./publish";
import { getMountIntegration } from "./service";
import { createMountPublishSource } from "./source";
import {
  type MountEntityType,
  type MountPublishRecord,
  parseMountPublishRecords
} from "./types";

const logger = getLogger("ee", "mount");

type StoredSettings = {
  partDefinitionSlug?: string;
  customerTypeTitle?: string;
  supplierTypeTitle?: string;
};

/**
 * One batch of one entity type's publish run. The first batch marks the run
 * as running before it pushes anything, so the page can show it; every batch
 * then adds its outcome to the run's record. `final` tells the job to stop.
 */
export async function runMountPublishBatch({
  serviceRole,
  db,
  companyId,
  entityType,
  run,
  batch,
  limit = MOUNT_PUBLISH_BATCH_SIZE
}: {
  serviceRole: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  entityType: MountEntityType;
  run: MountPublishRun;
  batch: number;
  limit?: number;
}): Promise<
  | { status: "inactive" }
  | { status: "ran"; record: MountPublishRecord; final: boolean }
> {
  const integration = await getMountIntegration(serviceRole, companyId);
  // A failed lookup is not "inactive": throw so the job step retries.
  if (integration.error) {
    logger.error("Failed to read Mount integration", {
      companyId,
      error: integration.error
    });
    throw new Error("Failed to read Mount integration");
  }
  if (!integration.data?.[0]?.active) {
    return { status: "inactive" };
  }

  const metadata = integration.data[0].metadata;
  const stored = (metadata ?? {}) as StoredSettings;

  let current = parseMountPublishRecords(metadata)[entityType];
  // A record with this run's id already belongs to it: a retried first batch
  // keeps what the earlier attempt recorded.
  if (current?.runId !== run.runId) {
    current = startPublishRecord(current, run);
    await writePublishRecord(serviceRole, companyId, entityType, current);
  }

  const { settings, warnings } = await resolveSettings(
    companyId,
    entityType,
    stored
  );

  const summary = await publishEntityType(
    createMountPublishSource(db, companyId),
    createMappingService(db, companyId),
    getMountClient(),
    companyId,
    entityType,
    settings,
    limit,
    current.deferred
  );
  summary.warnings.push(...warnings);

  const final = isFinalBatch(summary, batch);
  const record = applyBatchToRecord(current, summary, {
    final,
    at: datetime.timestamp()
  });
  await writePublishRecord(serviceRole, companyId, entityType, record);

  return { status: "ran", record, final };
}

/**
 * Record a run that failed outright (its retries ran out). Entity types the
 * run already finished, completed or stopped by a setting, keep their result.
 * Returns what it wrote, so the job can tell the person who started the run.
 */
export async function markMountPublishFailed({
  serviceRole,
  companyId,
  entityTypes,
  run,
  error
}: {
  serviceRole: SupabaseClient<Database>;
  companyId: string;
  entityTypes: MountEntityType[];
  run: MountPublishRun;
  error: string;
}): Promise<
  Array<{ entityType: MountEntityType; record: MountPublishRecord }>
> {
  const integration = await getMountIntegration(serviceRole, companyId);
  if (integration.error || !integration.data?.[0]) {
    logger.error("Failed to read Mount integration to record a failed run", {
      companyId,
      error: integration.error
    });
    return [];
  }

  const records = parseMountPublishRecords(integration.data[0].metadata);
  const at = datetime.timestamp();
  const written: Array<{
    entityType: MountEntityType;
    record: MountPublishRecord;
  }> = [];

  for (const entityType of entityTypes) {
    const current = records[entityType];
    if (current?.runId === run.runId && current.status !== "running") {
      continue;
    }
    const record = failPublishRecord(current, run, error, at);
    await writePublishRecord(serviceRole, companyId, entityType, record);
    written.push({ entityType, record });
  }

  return written;
}

/**
 * Settings hold what a Mount user can see — the definition's slug and the
 * company types' titles or identifiers. They are resolved to ids per batch,
 * and only the ones this entity type uses, so a parts push never fails on a
 * company-type lookup.
 */
async function resolveSettings(
  companyId: string,
  entityType: MountEntityType,
  stored: StoredSettings
): Promise<{ settings: MountPublishSettings; warnings: string[] }> {
  const api = getMountClient();

  if (entityType === "item") {
    const definition = stored.partDefinitionSlug
      ? await api.findObjectDefinitionBySlug(
          companyId,
          stored.partDefinitionSlug
        )
      : null;
    const availablePartDefinitionSlugs =
      stored.partDefinitionSlug && !definition
        ? await listForMessage(companyId, async () =>
            (await api.listObjectDefinitions(companyId)).flatMap((entry) =>
              entry.slug ? [entry.slug] : []
            )
          )
        : null;
    return {
      settings: {
        partDefinitionSlug: stored.partDefinitionSlug ?? null,
        partDefinitionId: definition?.id ?? null,
        availablePartDefinitionSlugs
      },
      warnings: []
    };
  }

  // The setting is an override. Empty, it picks Mount's own Customer or
  // Supplier type, which every tenant seen so far has.
  const isCustomer = entityType === "customer";
  const setting = (
    isCustomer ? stored.customerTypeTitle : stored.supplierTypeTitle
  )?.trim();
  const name = setting || (isCustomer ? "Customer" : "Supplier");
  const types = await api.listCompanyTypes(companyId);
  const type = matchCompanyType(types, name);
  const warnings: string[] = [];
  if (!type) {
    const label = isCustomer ? "Customer" : "Supplier";
    const has = describeMountHas(types.map((entry) => entry.title));
    const sent = `${isCustomer ? "Customers" : "Suppliers"} were sent without a type.`;
    warnings.push(
      setting
        ? `${label} company type "${setting}" isn't in Mount.${has} ${sent}`
        : `Mount has no company type called "${name}".${has} ${sent} Set ${label} company type in the integration settings to choose one.`
    );
  }

  return {
    settings:
      entityType === "customer"
        ? { customerTypeId: type?.id ?? null }
        : { supplierTypeId: type?.id ?? null },
    warnings
  };
}

/**
 * Read what Mount has, to name it beside a setting that matched nothing. The
 * message is still useful without it, so a failed read is logged, not thrown.
 */
async function listForMessage(
  companyId: string,
  read: () => Promise<string[]>
): Promise<string[] | null> {
  try {
    return await read();
  } catch (error) {
    logger.warn("Failed to list Mount options for a settings message", {
      companyId,
      error
    });
    return null;
  }
}

/**
 * Write one entity type's record through the atomic patch, so a settings save
 * landing mid-run is neither overwritten nor overwrites the record.
 */
async function writePublishRecord(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  entityType: MountEntityType,
  record: MountPublishRecord
) {
  try {
    await patchIntegrationState(serviceRole, companyId, MOUNT_INTEGRATION_ID, {
      metadata: { [`lastPublish.${entityType}`]: record as never }
    });
  } catch (error) {
    // Throw rather than carry on: a lost write drops the deferred ids and
    // leaves the page reporting a run that is not happening. A throw fails the
    // job step, which Inngest retries.
    logger.error("Failed to record Mount publish outcome", {
      companyId,
      entityType,
      error
    });
    throw new Error("Failed to record Mount publish outcome");
  }
}
