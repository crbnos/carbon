import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

// Drop old notification rows so the table doesn't grow unbounded. We keep
// unread rows forever — only read or already-digested rows are purged.
// READ must stay > DIGESTED: children can be milliseconds younger than their
// digest parent, and a parent deleted while children remain orphans them
// (digestedInto is ON DELETE SET NULL) back into the topbar as unread rows.
const PURGE_READ_AFTER_DAYS = 31;
const PURGE_DIGESTED_AFTER_DAYS = 30;

export const notificationPurgeFunction = inngest.createFunction(
  { id: "notification-purge", retries: 2 },
  { cron: "0 3 * * *" },
  async ({ step, logger }) => {
    const client = getCarbonServiceRole();

    // Digested children are purged before read parents (and a day earlier via
    // the staggered cutoffs) so a parent is never deleted while its children
    // remain — see the constant comment above.
    const purgedDigested = await step.run("purge-digested", async () => {
      const cutoff = new Date(
        Date.now() - PURGE_DIGESTED_AFTER_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data, error } = await (client.from as any)("notification")
        .delete()
        .lt("createdAt", cutoff)
        .not("digestedInto", "is", null)
        .select("id");

      if (error) {
        logger.error("Failed to purge digested notifications", { error });
        throw error;
      }
      return data?.length ?? 0;
    });

    const purgedRead = await step.run("purge-read", async () => {
      const cutoff = new Date(
        Date.now() - PURGE_READ_AFTER_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data, error } = await (client.from as any)("notification")
        .delete()
        .lt("createdAt", cutoff)
        .not("readAt", "is", null)
        .select("id");

      if (error) {
        logger.error("Failed to purge read notifications", { error });
        throw error;
      }
      return data?.length ?? 0;
    });

    return { purgedDigested, purgedRead };
  }
);
