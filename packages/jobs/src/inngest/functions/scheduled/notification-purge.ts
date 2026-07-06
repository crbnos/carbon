import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

// Drop old notification rows so the table doesn't grow unbounded. We keep
// unread rows forever — only read or already-digested rows are purged.
const PURGE_READ_AFTER_DAYS = 30;
const PURGE_DIGESTED_AFTER_DAYS = 30;

export const notificationPurgeFunction = inngest.createFunction(
  { id: "notification-purge", retries: 2 },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const client = getCarbonServiceRole();

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
        console.error("Failed to purge read notifications", error);
        throw error;
      }
      return data?.length ?? 0;
    });

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
        console.error("Failed to purge digested notifications", error);
        throw error;
      }
      return data?.length ?? 0;
    });

    return { purgedDigested, purgedRead };
  }
);
