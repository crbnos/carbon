// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getErrorMessage, groupBy, indexByMapped } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { getJobDatabaseClient, type JobDatabase } from "../../../db";
import { inngest } from "../../client.js";

type EmbedRecord = { id: string; table: string };
/** `permanent` failures can never succeed on retry (unknown table, no text). */
type FailedRecord<R> = { record: R; error: string; permanent: boolean };

const EMBEDDED_TABLES = ["item", "customer", "supplier"] as const;
type EmbeddedTable = (typeof EMBEDDED_TABLES)[number];
const isEmbeddedTable = (table: string): table is EmbeddedTable =>
  (EMBEDDED_TABLES as readonly string[]).includes(table);

/** The `embedding` edge function's batch limit. */
const MAX_TEXTS_PER_CALL = 100;

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

/** The edge function's own sanitizing: text it would refuse as empty is
 *  caught here, so one bad row cannot fail a whole batch. */
export function toEmbeddedText(parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\0/g, "")
    .replace(CONTROL_CHARACTERS, " ")
    .trim()
    .replace(/\s+/g, " ");
}

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
      (row) => toEmbeddedText([row.name, row.description])
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
    (row) => toEmbeddedText([row.name])
  );
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const { data, error } = await getCarbonServiceRole().functions.invoke(
    "embedding",
    { body: { texts } }
  );
  if (error) {
    // A FunctionsHttpError's own message is generic; the reason is the body's.
    const body = await (error as { context?: Response }).context
      ?.json()
      .catch(() => null);
    throw new Error(body?.message || error.message);
  }
  return (data as { embeddings: number[][] }).embeddings;
}

async function writeEmbeddings(
  db: JobDatabase,
  table: EmbeddedTable,
  rows: { id: string; vector: number[] }[]
): Promise<void> {
  await sql`
    UPDATE ${sql.table(table)} AS t
    SET "embedding" = v.embedding::extensions.halfvec
    FROM (VALUES ${sql.join(
      rows.map((row) => sql`(${row.id}, ${JSON.stringify(row.vector)})`)
    )}) AS v(id, embedding)
    WHERE t."id" = v.id
  `.execute(db);
}

/**
 * Sorts one table's records by their text and embeds the ones that have some,
 * `MAX_TEXTS_PER_CALL` at a time through `embedBatch` (which embeds and
 * writes). A row with no entry in `texts` is gone: nothing is left to embed,
 * so it counts as done. Blank text can never succeed. A failed batch is
 * retried record by record, so one bad row fails alone.
 */
export async function embedInBatches<R extends EmbedRecord>(
  records: R[],
  texts: Map<string, string>,
  embedBatch: (batch: R[]) => Promise<void>
): Promise<{ embedded: R[]; failed: FailedRecord<R>[] }> {
  const embedded: R[] = [];
  const failed: FailedRecord<R>[] = [];
  const pending: R[] = [];
  for (const record of records) {
    const text = texts.get(record.id);
    if (text === undefined) embedded.push(record);
    else if (text) pending.push(record);
    else {
      failed.push({
        record,
        error: `${record.table} ${record.id} has no text`,
        permanent: true
      });
    }
  }

  const attempt = async (batch: R[]) => {
    try {
      await embedBatch(batch);
      embedded.push(...batch);
      return true;
    } catch (error) {
      if (batch.length === 1) {
        failed.push({
          record: batch[0]!,
          error: getErrorMessage(error, "Embedding failed"),
          permanent: false
        });
      }
      return false;
    }
  };

  for (let i = 0; i < pending.length; i += MAX_TEXTS_PER_CALL) {
    const batch = pending.slice(i, i + MAX_TEXTS_PER_CALL);
    if (!(await attempt(batch)) && batch.length > 1) {
      for (const record of batch) await attempt([record]);
    }
  }
  return { embedded, failed };
}

/**
 * Embeds each record's text through the `embedding` edge function and writes
 * the vectors, one UPDATE per batch. Returns the input records (the same
 * objects, so callers can carry their own fields) split into embedded and
 * failed.
 */
export async function embedRecords<R extends EmbedRecord>(
  db: JobDatabase,
  records: R[]
): Promise<{ embedded: R[]; failed: FailedRecord<R>[] }> {
  const embedded: R[] = [];
  const failed: FailedRecord<R>[] = [];

  for (const [table, tableRecords] of Object.entries(
    groupBy(records, (record) => record.table)
  )) {
    if (!isEmbeddedTable(table)) {
      failed.push(
        ...tableRecords.map((record) => ({
          record,
          error: `${table} is not embedded`,
          permanent: true
        }))
      );
      continue;
    }

    const texts = await loadTexts(db, table, [
      ...new Set(tableRecords.map((record) => record.id))
    ]);
    const result = await embedInBatches(tableRecords, texts, async (batch) => {
      const vectors = await embedTexts(
        batch.map((record) => texts.get(record.id)!)
      );
      await writeEmbeddings(
        db,
        table,
        batch.map((record, index) => ({
          id: record.id,
          vector: vectors[index]!
        }))
      );
    });
    embedded.push(...result.embedded);
    failed.push(...result.failed);
  }

  return { embedded, failed };
}

const EMBEDDING_QUEUE = "embedding_jobs";
const QUEUE_BATCH_SIZE = 100;
const QUEUE_VISIBILITY_SECONDS = 300;
const MAX_PASSES = 10;
/** A message still failing after this many reads is archived, not retried. */
const MAX_READS = 5;

/**
 * Drains the pgmq `embedding_jobs` queue (filled by util.queue_embeddings).
 * Woken by `carbon/embedding-queue.process`, which the 10 s `process-embeddings`
 * pg_cron job sends while visible messages are waiting. A failed message stays
 * queued and becomes visible again after the visibility timeout; one that can
 * never succeed, or has failed `MAX_READS` times, is archived so it cannot keep
 * waking the drain.
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
        const { rows } = await sql<{
          msg_id: string;
          read_ct: number;
          message: EmbedRecord;
        }>`
          SELECT msg_id, read_ct, message
          FROM pgmq.read(${EMBEDDING_QUEUE}, ${QUEUE_VISIBILITY_SECONDS}, ${QUEUE_BATCH_SIZE})
        `.execute(db);
        const { embedded, failed } = await embedRecords(
          db,
          rows.map((row) => ({
            ...row.message,
            msgId: row.msg_id,
            reads: row.read_ct
          }))
        );
        const doneIds = embedded.map((record) => record.msgId);
        const deadIds = failed
          .filter((f) => f.permanent || f.record.reads >= MAX_READS)
          .map((f) => f.record.msgId);
        if (doneIds.length > 0) {
          await sql`SELECT pgmq.delete(${EMBEDDING_QUEUE}, ${doneIds}::bigint[])`.execute(
            db
          );
        }
        if (deadIds.length > 0) {
          await sql`SELECT pgmq.archive(${EMBEDDING_QUEUE}, ${deadIds}::bigint[])`.execute(
            db
          );
        }
        return {
          read: rows.length,
          failed: failed.map(({ record, error }) => ({
            table: record.table,
            id: record.id,
            error
          }))
        };
      });
      for (const { table, id, error } of failed) {
        logger.warn(`Embedding ${table} ${id} failed: ${error}`);
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
