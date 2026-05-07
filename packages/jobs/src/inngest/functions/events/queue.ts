import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import type { HandlerType, QueueMessage } from "@carbon/database/event";
import { type Kysely, PostgresDriver, sql } from "kysely";
import { inngest } from "../../client";

const QUEUE_NAME = "event_system"; // Name of the PGMQ queue
const BATCH_SIZE = 100; // Number of messages to process per run
const VISIBILITY_TIMEOUT = 30; // Seconds a message is hidden after being read
const CHUNK_SIZE = 10; // Max events per sendEvent call (keeps under 256KB limit)

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const getDatabaseClient = (size: number) => {
  const pool = getPostgresConnectionPool(size);
  return getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
};

type QueueJob = {
  msg_id: number;
  message: QueueMessage;
};

/**
 * Event queue cron function - polls PGMQ every minute and routes events to handlers.
 * This is the critical bridge between PostgreSQL events and inngest handlers.
 */
export const eventQueueFunction = inngest.createFunction(
  {
    id: "event-queue",
    retries: 2
  },
  { cron: "* * * * *" }, // Every minute
  async ({ step }) => {
    // 1. Read batch from PGMQ (checkpointed so replays don't re-read)
    type ReadQueueResult = {
      grouped: Record<HandlerType, QueueJob[]>;
      allIds: number[];
    };

    const { grouped, allIds } = (await step.run("read-queue", async () => {
      const pg = getDatabaseClient(1);
      const { rows: jobs } =
        await sql<QueueJob>`SELECT * FROM pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT}, ${BATCH_SIZE})`.execute(
          pg
        );

      const grouped: Record<HandlerType, QueueJob[]> = {
        WEBHOOK: [],
        WORKFLOW: [],
        SYNC: [],
        SEARCH: [],
        AUDIT: [],
        EMBEDDING: []
      };

      for (const job of jobs) {
        grouped[job.message.handlerType].push(job);
      }

      return {
        grouped,
        allIds: jobs.map((j) => j.msg_id)
      };
    })) as ReadQueueResult;

    if (allIds.length === 0) {
      return { processed: 0 };
    }

    // 3. Dispatch webhooks
    if (grouped.WEBHOOK.length > 0) {
      const events = grouped.WEBHOOK.map((job) => ({
        name: "carbon/event-webhook" as const,
        data: {
          msgId: job.msg_id,
          url: job.message.handlerConfig.url,
          config: job.message.handlerConfig,
          data: job.message.event
        }
      }));

      const chunks = chunk(events, CHUNK_SIZE);
      for (let i = 0; i < chunks.length; i++) {
        await step.sendEvent(`dispatch-webhooks-${i}`, chunks[i]!);
      }
    }

    // 4. Dispatch workflows
    if (grouped.WORKFLOW.length > 0) {
      const events = grouped.WORKFLOW.map((job) => ({
        name: "carbon/event-workflow" as const,
        data: {
          msgId: job.msg_id,
          workflowId: job.message.handlerConfig.workflowId,
          data: job.message.event
        }
      }));

      const chunks = chunk(events, CHUNK_SIZE);
      for (let i = 0; i < chunks.length; i++) {
        await step.sendEvent(`dispatch-workflows-${i}`, chunks[i]!);
      }
    }

    // 5. Dispatch syncs (chunked)
    if (grouped.SYNC.length > 0) {
      const records = grouped.SYNC.map((job) => ({
        event: job.message.event,
        companyId: job.message.companyId,
        handlerConfig: job.message.handlerConfig
      }));

      const chunks = chunk(records, CHUNK_SIZE);
      for (let i = 0; i < chunks.length; i++) {
        await step.sendEvent(`dispatch-syncs-${i}`, {
          name: "carbon/event-sync" as const,
          data: { records: chunks[i] }
        });
      }
    }

    // 6. Dispatch searches (chunked)
    if (grouped.SEARCH.length > 0) {
      const records = grouped.SEARCH.map((job) => ({
        event: job.message.event,
        companyId: job.message.companyId
      }));

      const chunks = chunk(records, CHUNK_SIZE);
      for (let i = 0; i < chunks.length; i++) {
        await step.sendEvent(`dispatch-searches-${i}`, {
          name: "carbon/event-search" as const,
          data: { records: chunks[i] }
        });
      }
    }

    // 7. Dispatch audits (chunked)
    if (grouped.AUDIT.length > 0) {
      const records = grouped.AUDIT.map((job) => ({
        event: job.message.event,
        companyId: job.message.companyId,
        actorId: job.message.actorId,
        handlerConfig: job.message.handlerConfig
      }));

      const chunks = chunk(records, CHUNK_SIZE);
      for (let i = 0; i < chunks.length; i++) {
        await step.sendEvent(`dispatch-audits-${i}`, {
          name: "carbon/event-audit" as const,
          data: { records: chunks[i] }
        });
      }
    }

    // 8. Dispatch embeddings (chunked)
    if (grouped.EMBEDDING.length > 0) {
      const records = grouped.EMBEDDING.map((job) => ({
        event: job.message.event,
        companyId: job.message.companyId
      }));

      const chunks = chunk(records, CHUNK_SIZE);
      for (let i = 0; i < chunks.length; i++) {
        await step.sendEvent(`dispatch-embeddings-${i}`, {
          name: "carbon/event-embedding" as const,
          data: { records: chunks[i] }
        });
      }
    }

    // 9. Delete processed messages from PGMQ
    await step.run("delete-processed", async () => {
      const pg = getDatabaseClient(1);
      await sql`SELECT pgmq.delete(${QUEUE_NAME}, id::bigint) FROM unnest(${allIds}::bigint[]) AS id`.execute(
        pg
      );
    });

    return { routed: allIds.length };
  }
);
