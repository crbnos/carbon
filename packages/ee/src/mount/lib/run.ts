// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMappingService } from "../../accounting/core/external-mapping";
import { getMountClient } from "./client";
import { MOUNT_INTEGRATION_ID } from "./constants";
import {
  MOUNT_PUBLISH_BATCH_SIZE,
  type MountPublishSettings,
  type MountPublishSummary,
  publishEntityType
} from "./publish";
import { getMountIntegration } from "./service";
import { createMountPublishSource } from "./source";
import type { MountEntityType } from "./types";

const logger = getLogger("ee", "mount");

export async function runMountPublish({
  serviceRole,
  db,
  companyId,
  entityTypes,
  limit = MOUNT_PUBLISH_BATCH_SIZE
}: {
  serviceRole: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  entityTypes: MountEntityType[];
  limit?: number;
}): Promise<
  { status: "inactive" } | { status: "ran"; summaries: MountPublishSummary[] }
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

  const stored = (integration.data[0].metadata ?? {}) as {
    partDefinitionSlug?: string;
    customerTypeTitle?: string;
    supplierTypeTitle?: string;
    lastPublish?: Partial<
      Record<MountEntityType, { deferred?: string[] } | undefined>
    >;
  };

  const api = getMountClient();

  // Settings hold what a Mount user can actually see — the definition's slug
  // and the company types' titles. Resolve them to ids per run rather than
  // storing ids the user has no way to read back.
  const [definition, customerType, supplierType] = await Promise.all([
    stored.partDefinitionSlug
      ? api.findObjectDefinitionBySlug(companyId, stored.partDefinitionSlug)
      : null,
    stored.customerTypeTitle
      ? api.findCompanyTypeByTitle(companyId, stored.customerTypeTitle)
      : null,
    stored.supplierTypeTitle
      ? api.findCompanyTypeByTitle(companyId, stored.supplierTypeTitle)
      : null
  ]);

  const settings: MountPublishSettings = {
    partDefinitionId: definition?.id ?? null,
    customerTypeId: customerType?.id ?? null,
    supplierTypeId: supplierType?.id ?? null
  };

  const mappings = createMappingService(db, companyId);
  const source = createMountPublishSource(db, companyId);

  const summaries: MountPublishSummary[] = [];
  for (const entityType of entityTypes) {
    summaries.push(
      await publishEntityType(
        source,
        mappings,
        api,
        companyId,
        entityType,
        settings,
        limit,
        stored.lastPublish?.[entityType]?.deferred ?? []
      )
    );
  }

  await recordOutcome(serviceRole, companyId, summaries);

  return { status: "ran", summaries };
}

async function recordOutcome(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  summaries: MountPublishSummary[]
) {
  // Throw rather than carry on: writing back without the stored metadata
  // would drop the saved settings, and a lost write drops the deferred ids.
  // A throw fails the job step, which Inngest retries.
  const current = await getMountIntegration(serviceRole, companyId);
  if (current.error || !current.data?.[0]) {
    logger.error("Failed to read Mount integration to record publish outcome", {
      companyId,
      error: current.error
    });
    throw new Error("Failed to read Mount integration");
  }
  const metadata = (current.data[0].metadata ?? {}) as Record<string, unknown>;

  const lastPublish = {
    ...((metadata.lastPublish as Record<string, unknown>) ?? {}),
    ...Object.fromEntries(
      summaries.map((summary) => [
        summary.entityType,
        {
          at: datetime.timestamp(),
          created: summary.created,
          updated: summary.updated,
          more: summary.more,
          ambiguous: summary.ambiguous,
          failed: summary.failed,
          deferred: summary.deferred
        }
      ])
    )
  };

  const update = await serviceRole
    .from("companyIntegration")
    .update({ metadata: { ...metadata, lastPublish } as never })
    .eq("companyId", companyId)
    .eq("id", MOUNT_INTEGRATION_ID);

  if (update.error) {
    logger.error("Failed to record Mount publish outcome", {
      companyId,
      error: update.error
    });
    throw new Error("Failed to record Mount publish outcome");
  }
}
