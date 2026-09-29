import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { groupBy, indexByMapped } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { getJobDatabaseClient, type JobDatabase } from "../../../db";
import { inngest } from "../../client.js";

type EmbedRecord = { id: string; table: string };
type FailedRecord = { record: EmbedRecord; error: string };

const EMBEDDED_TABLES = ["item", "customer", "supplier"] as const;
type EmbeddedTable = (typeof EMBEDDED_TABLES)[number];
const isEmbeddedTable = (table: string): table is EmbeddedTable =>
  (EMBEDDED_TABLES as readonly string[]).includes(table);

/** The `embedding` edge function's batch limit. */
const MAX_TEXTS_PER_CALL = 100;

/** The text each row is embedded from, by id. A missing id means the row is gone. */
async function loadTexts(
  db: JobDatabase,
  table: EmbeddedTable,
  ids: string[]
): Promise<Map<string, string>> {
  if (table === "item") {
    const rows = await db
      .selectFrom("item")
      .select(["id", "name", "description"])
      .where("id", "in", ids)
      .execute();
    return indexByMapped(
      rows,
      (row) => row.id,
      (row) => [row.name, row.description].filter(Boolean).join(" ")
    );
  }
  const rows = await db
    .selectFrom(table)
    .select(["id", "name"])
    .where("id", "in", ids)
    .execute();
  return indexByMapped(
    rows,
    (row) => row.id,
    (row) => row.name ?? ""
  );
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const { data, error } = await getCarbonServiceRole().functions.invoke(
    "embedding",
    { body: { texts } }
  );
  if (error) throw error;
  return (data as { embeddings: number[][] }).embeddings;
}

/**
 * Embeds each record's text through the `embedding` edge function and writes
 * the vectors, one UPDATE per table. Returns the input records split into
 * embedded (including rows that no longer exist: nothing is left to embed)
 * and failed.
 */
export async function embedRecords(
  db: JobDatabase,
  records: EmbedRecord[]
): Promise<{ embedded: EmbedRecord[]; failed: FailedRecord[] }> {
  const embedded: EmbedRecord[] = [];
  const failed: FailedRecord[] = [];

  for (const [table, tableRecords] of Object.entries(
    groupBy(records, (record) => record.table)
  )) {
    if (!isEmbeddedTable(table)) {
      failed.push(
        ...tableRecords.map((record) => ({
          record,
          error: `${table} is not embedded`
        }))
      );
      continue;
    }

    const texts = await loadTexts(db, table, [
      ...new Set(tableRecords.map((record) => record.id))
    ]);
    const pending: EmbedRecord[] = [];
    for (const record of tableRecords) {
      const text = texts.get(record.id);
      if (text === undefined) embedded.push(record);
      else if (text) pending.push(record);
      else failed.push({ record, error: `${table} ${record.id} has no text` });
    }

    for (let i = 0; i < pending.length; i += MAX_TEXTS_PER_CALL) {
      const batch = pending.slice(i, i + MAX_TEXTS_PER_CALL);
      try {
        const vectors = await embedTexts(
          batch.map((record) => texts.get(record.id)!)
        );
        await sql`
          UPDATE ${sql.table(table)} AS t
          SET "embedding" = v.embedding::extensions.halfvec
          FROM (VALUES ${sql.join(
            batch.map(
              (record, index) =>
                sql`(${record.id}, ${JSON.stringify(vectors[index])})`
            )
          )}) AS v(id, embedding)
          WHERE t."id" = v.id
        `.execute(db);
        embedded.push(...batch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(...batch.map((record) => ({ record, error: message })));
      }
    }
  }

  return { embedded, failed };
}

const EMBEDDING_QUEUE = "embedding_jobs";
const QUEUE_BATCH_SIZE = 100;
const QUEUE_VISIBILITY_SECONDS = 300;
const MAX_PASSES = 10;

/**
 * Drains the pgmq `embedding_jobs` queue (filled by util.queue_embeddings).
 * Woken by `carbon/embedding-queue.process`, which the 10 s `process-embeddings`
 * pg_cron job sends while visible messages are waiting. A failed message stays
 * queued and becomes visible again after the visibility timeout.
 */
export const embeddingQueueFunction = inngest.createFunction(
  {
    id: "embedding-queue",
    retries: 2,
    concurrency: 1,
    singleton: { mode: "skip" }
  },
  { event: "carbon/embedding-queue.process" },
  async ({ step, logger }) => {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const { read, failed } = await step.run(`drain-${pass}`, async () => {
        const db = getJobDatabaseClient();
        const { rows } = await sql<{ msg_id: string; message: EmbedRecord }>`
          SELECT msg_id, message
          FROM pgmq.read(${EMBEDDING_QUEUE}, ${QUEUE_VISIBILITY_SECONDS}, ${QUEUE_BATCH_SIZE})
        `.execute(db);
        const result = await embedRecords(
          db,
          rows.map((row) => row.message)
        );
        const done = new Set(result.embedded);
        const doneIds = rows
          .filter((row) => done.has(row.message))
          .map((row) => row.msg_id);
        if (doneIds.length > 0) {
          await sql`SELECT pgmq.delete(${EMBEDDING_QUEUE}, ${doneIds}::bigint[])`.execute(
            db
          );
        }
        return { read: rows.length, failed: result.failed };
      });
      for (const { record, error } of failed) {
        logger.warn(`Embedding ${record.table} ${record.id} failed: ${error}`);
      }
      if (read < QUEUE_BATCH_SIZE) break;
    }
  }
);

// Fields that affect embeddings for each table
const EMBEDDING_FIELDS: Record<string, string[]> = {
  item: ["name", "description"],
  customer: ["name"],
  supplier: ["name"]
};

const EmbeddingRecordSchema = z.object({
  event: z.object({
    table: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]),
    recordId: z.string(),
    new: z.record(z.string(), z.any()).nullable(),
    old: z.record(z.string(), z.any()).nullable(),
    timestamp: z.string()
  }),
  companyId: z.string()
});

const EmbeddingPayloadSchema = z.object({
  records: z.array(EmbeddingRecordSchema)
});

export type EmbeddingPayload = z.infer<typeof EmbeddingPayloadSchema>;

export const embeddingFunction = inngest.createFunction(
  {
    id: "event-handler-embedding",
    retries: 3
  },
  { event: "carbon/event-embedding" },
  async ({ event, step, logger }) => {
    return await step.run("process-embeddings", async () => {
      const payload = EmbeddingPayloadSchema.parse(event.data);

      const results = { processed: 0, skipped: 0, failed: 0 };

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
        logger.info(
          `Embedding handler: nothing to process, skipped=${results.skipped}`
        );
        return results;
      }

      const { embedded, failed } = await embedRecords(
        getJobDatabaseClient(),
        jobs
      );
      results.processed = embedded.length;
      results.failed = failed.length;
      for (const { record, error } of failed) {
        logger.error(`Embedding ${record.table} ${record.id} failed: ${error}`);
      }

      logger.info(
        `Embedding handler: processed=${results.processed}, skipped=${results.skipped}, failed=${results.failed}`
      );

      return results;
    });
  }
);
