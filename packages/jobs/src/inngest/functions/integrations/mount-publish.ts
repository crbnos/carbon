// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  describePublishForNotification,
  MOUNT_ENTITY_TYPES,
  MOUNT_INTEGRATION_ID,
  MOUNT_PUBLISH_MAX_BATCHES,
  type MountEntityType,
  type MountPublishRecord,
  markMountPublishFailed,
  runMountPublishBatch
} from "@carbon/ee/mount.server";
import { trigger } from "@carbon/lib/trigger";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { datetime } from "@carbon/utils";
import z from "zod";
/**
 * Mount publish sweep — the "Push customers / suppliers / parts" actions on
 * the Mount integration's detail page, and the daily `mount-sweep`.
 *
 * Carbon is the master for all three; Mount is a downstream mirror that is
 * never read back. The sweep finds records Mount is missing or holds stale
 * (no mapping row, or the Carbon row changed after it was last published)
 * and pushes them one at a time.
 *
 * The sweep IS the retry. A record that fails is still stale on the next run,
 * so there is no operation ledger to keep truthful and no queue to drain —
 * deliberately less machinery than the accounting sync, which needs provable
 * completeness because it moves money.
 *
 * Each batch of 200 is its own step, and a run keeps taking batches until the
 * stale set is empty, a batch publishes nothing, or it reaches
 * MOUNT_PUBLISH_MAX_BATCHES. Progress and the outcome are written to
 * `lastPublish.{entityType}` on the integration, which the integration page
 * reads. A manual run that needs attention notifies the person who started it.
 */
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

const log = getLogger("jobs", "mount-publish");

const MountPublishPayloadSchema = z.object({
  companyId: z.string(),
  entityTypes: z
    .array(z.enum(MOUNT_ENTITY_TYPES))
    .min(1)
    .default([...MOUNT_ENTITY_TYPES]),
  userId: z.string().optional(),
  requestId: z.string().optional(),
  trigger: z.enum(["manual", "schedule"]).default("manual")
});

type MountPublishPayload = z.infer<typeof MountPublishPayloadSchema>;

export const mountPublishFunction = inngest.createFunction(
  {
    id: "mount-publish",
    retries: 2,
    // One publish run per company at a time. Two overlapping runs would race
    // on the same stale set and double-POST records Mount cannot de-duplicate
    // for us — it has no idempotency key.
    concurrency: { key: "event.data.companyId", limit: 1 },
    onFailure: async ({ event, step }) => {
      const parsed = MountPublishPayloadSchema.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const payload = parsed.data;

      const written = await step.run("record-failure", async () =>
        markMountPublishFailed({
          serviceRole: getCarbonServiceRole(),
          companyId: payload.companyId,
          entityTypes: payload.entityTypes,
          run: {
            runId: event.data.run_id,
            requestId: payload.requestId ?? null,
            trigger: payload.trigger,
            startedAt: datetime.timestamp()
          },
          error: event.data.error.message
        })
      );

      await step.run("notify-failure", async () =>
        notifyPublisher(payload, written as PublishedRecords)
      );
    }
  },
  { event: "carbon/mount-publish" },
  async ({ event, step, runId }) => {
    const payload = MountPublishPayloadSchema.parse(event.data);
    const { companyId } = payload;

    // A step, so every replay of this run agrees on when it started.
    const startedAt = await step.run("start", async () => datetime.timestamp());
    const run = {
      runId,
      requestId: payload.requestId ?? null,
      trigger: payload.trigger,
      startedAt
    };

    const records: PublishedRecords = [];
    for (const entityType of payload.entityTypes) {
      let last: MountPublishRecord | null = null;
      for (let batch = 0; batch < MOUNT_PUBLISH_MAX_BATCHES; batch++) {
        // The sweep is idempotent, so a retried batch replaying records that
        // already published is harmless.
        const result = await step.run(
          `publish-${entityType}-${batch}`,
          async () =>
            runMountPublishBatch({
              serviceRole: getCarbonServiceRole(),
              db: getJobDatabaseClient(),
              companyId,
              entityType,
              run,
              batch
            })
        );

        if (result.status === "inactive") {
          log.warn("Mount integration missing or inactive", { companyId });
          return { skipped: "integration-inactive" as const };
        }

        last = result.record as MountPublishRecord;
        if (result.final) break;
      }
      // After the loop rather than on the final batch, so an entity type is
      // reported even if the loop's cap and isFinalBatch's ever disagree.
      if (last) records.push({ entityType, record: last });
    }

    log.info("Mount publish complete", {
      companyId,
      trigger: payload.trigger,
      outcomes: records.map(({ entityType, record }) => ({
        entityType,
        created: record.created,
        updated: record.updated,
        ambiguous: record.ambiguous.length,
        failed: record.failed.length,
        more: record.more
      }))
    });

    await step.run("notify", async () => notifyPublisher(payload, records));

    return { records };
  }
);

type PublishedRecords = Array<{
  entityType: MountEntityType;
  record: MountPublishRecord;
}>;

/**
 * Tell the person who pressed Push when the run needs something from them.
 * Scheduled runs notify nobody: the same stuck record would notify every day,
 * and the integration page already shows it.
 */
async function notifyPublisher(
  payload: MountPublishPayload,
  records: PublishedRecords
) {
  if (payload.trigger !== "manual" || !payload.userId) {
    return { notified: false };
  }

  const message = describePublishForNotification(records);
  if (!message) return { notified: false };

  try {
    await trigger("notify", {
      event: NotificationEvent.IntegrationSync,
      companyId: payload.companyId,
      documentId: MOUNT_INTEGRATION_ID,
      title: message.title,
      body: message.body,
      recipient: { type: "user", userId: payload.userId }
    });
  } catch (error) {
    log.error("Failed to send Mount publish notification", {
      companyId: payload.companyId,
      error
    });
    return { notified: false };
  }
  return { notified: true };
}
