// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { runMountPublish } from "@carbon/ee/mount.server";
import { getLogger } from "@carbon/logger";
import z from "zod";
/**
 * Mount publish sweep — the "Push customers / suppliers / parts" actions on
 * the Mount integration's detail page.
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
 * Started from the integration's actions today. A cron is a second trigger on
 * this same function, iterating every active Mount integration; nothing here
 * assumes a human started it.
 */
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

const log = getLogger("jobs", "mount-publish");

const MountPublishPayloadSchema = z.object({
  companyId: z.string(),
  entityTypes: z
    .array(z.enum(["customer", "supplier", "item"]))
    .min(1)
    .default(["customer", "supplier", "item"])
});

export const mountPublishFunction = inngest.createFunction(
  {
    id: "mount-publish",
    retries: 2,
    // One publish run per company at a time. Two overlapping runs would race
    // on the same stale set and double-POST records Mount cannot de-duplicate
    // for us — it has no idempotency key.
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/mount-publish" },
  async ({ event, step }) => {
    const { companyId, entityTypes } = MountPublishPayloadSchema.parse(
      event.data
    );

    // One step for the whole run: the sweep is idempotent, so a retry
    // replaying records that already published is harmless.
    const result = await step.run("publish", async () =>
      runMountPublish({
        serviceRole: getCarbonServiceRole(),
        db: getJobDatabaseClient(),
        companyId,
        entityTypes
      })
    );

    if (result.status === "inactive") {
      log.warn("Mount integration missing or inactive", { companyId });
      return { skipped: "integration-inactive" as const };
    }

    log.info("Mount publish complete", {
      companyId,
      summaries: result.summaries.map((summary) => ({
        entityType: summary.entityType,
        created: summary.created,
        updated: summary.updated,
        ambiguous: summary.ambiguous.length,
        failed: summary.failed.length,
        more: summary.more
      }))
    });

    return result;
  }
);
