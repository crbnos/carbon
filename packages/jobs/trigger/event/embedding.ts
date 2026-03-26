import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { logger, task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

// Fields that affect embeddings for each table
const EMBEDDING_FIELDS: Record<string, string[]> = {
  item: ["name", "description"],
  customer: ["name"],
  supplier: ["name"],
};

const EmbeddingRecordSchema = z.object({
  event: z.object({
    table: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
    recordId: z.string(),
    new: z.record(z.any()).nullable(),
    old: z.record(z.any()).nullable(),
    timestamp: z.string(),
  }),
  companyId: z.string(),
});

const EmbeddingPayloadSchema = z.object({
  records: z.array(EmbeddingRecordSchema),
});

export type EmbeddingPayload = z.infer<typeof EmbeddingPayloadSchema>;

export const embeddingTask = task({
  id: "event-handler-embedding",
  retry: {
    maxAttempts: 3,
    factor: 2,
    randomize: true,
  },
  run: async (input: unknown) => {
    const payload = EmbeddingPayloadSchema.parse(input);

    const results = { processed: 0, skipped: 0, failed: 0 };
    const client = getCarbonServiceRole();

    // Filter to only records that need embedding
    const jobs: { id: string; table: string }[] = [];

    for (const record of payload.records) {
      const { event } = record;
      const fields = EMBEDDING_FIELDS[event.table];

      if (!fields) {
        results.skipped++;
        continue;
      }

      if (event.operation === "DELETE" || event.operation === "TRUNCATE") {
        results.skipped++;
        continue;
      }

      if (event.operation === "UPDATE" && event.old && event.new) {
        const changed = fields.some((f) => event.old![f] !== event.new![f]);
        if (!changed) {
          results.skipped++;
          continue;
        }
      }

      jobs.push({ id: event.recordId, table: event.table });
    }

    if (jobs.length === 0) {
      logger.info(`Embedding handler: nothing to process, skipped=${results.skipped}`);
      return results;
    }

    // Call the embed edge function directly with a batch
    // The edge function expects: [{ jobId, id, table }]
    // jobId is used for pgmq cleanup — pass -1 since we're not coming from the queue
    const batch = jobs.map((job, i) => ({
      jobId: -(i + 1),
      ...job,
    }));

    const { error } = await client.functions.invoke("embed", {
      body: batch,
    });

    if (error) {
      logger.error(`Embed edge function failed: ${error.message}`);
      results.failed = jobs.length;
    } else {
      results.processed = jobs.length;
    }

    logger.info(
      `Embedding handler: processed=${results.processed}, skipped=${results.skipped}, failed=${results.failed}`
    );

    return results;
  },
});
