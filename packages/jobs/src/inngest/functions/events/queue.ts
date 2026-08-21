import type { HandlerType, QueueMessage } from "@carbon/database/event";
import { sql } from "kysely";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

const QUEUE_NAME = "event_system"; // Name of the PGMQ queue
const BATCH_SIZE = 100; // Number of messages to process per pass
const VISIBILITY_TIMEOUT = 30; // Seconds a message is hidden after being read
const CHUNK_SIZE = 10; // Max events per sendEvent call (keeps under 256KB limit)
const MAX_PASSES = 10; // Max read/dispatch/delete passes per run (~1000 msgs)

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

type QueueJob = {
  msg_id: number;
  message: QueueMessage;
};

/**
 * Event queue drainer - woken by `carbon/event-queue.process` and routes
 * queued PGMQ events to handlers. The database pushes the wake: the
 * dispatch_event_batch() trigger (and a pg_cron sweeper while messages are
 * pending) POSTs to the event-wake edge function, which sends the wake event.
 * The drain loops until the queue is empty, so a single run absorbs a burst.
 * `concurrency: 1` serializes runs; bulk writes are coalesced upstream — the
 * trigger wakes at most once per transaction (carbon.event_wake_sent GUC).
 * `singleton: skip` drops the *cross-transaction* pile-up: while a drain is in
 * flight, every further wake is skipped (not queued) — the running drain already
 * loops until empty and so absorbs their messages, and the drain's own re-wake +
 * the pg_cron sweeper cover the narrow race where a wake lands just as it exits.
 * So 10 wakes coalesce into 1 run instead of 1 run + 9 redundant empty drains.
 * This is the critical bridge between PostgreSQL events and inngest handlers.
 */
export const eventQueueFunction = inngest.createFunction(
  {
    id: "event-queue",
    retries: 2,
    concurrency: 1,
    singleton: { mode: "skip" }
  },
  { event: "carbon/event-queue.process" },
  async ({ step }) => {
    let routed = 0;
    let poisonedTotal = 0;
    let lastPassFull = false;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      // 1. Read batch from PGMQ (checkpointed so replays don't re-read)
      type ReadQueueResult = {
        grouped: Record<HandlerType, QueueJob[]>;
        allIds: number[];
        poisoned: number[];
      };

      const { grouped, allIds, poisoned } = (await step.run(
        `read-queue-${pass}`,
        async () => {
          const pg = getJobDatabaseClient();
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

          // Unknown handler types are poison: pushing into a missing bucket
          // would throw, crash-loop the drainer, and wedge ALL event
          // processing. Collect them for archival to pgmq's dead-letter
          // (pgmq.a_event_system) instead.
          const poisoned: number[] = [];
          const allIds: number[] = [];
          for (const job of jobs) {
            const bucket = grouped[job.message.handlerType];
            if (bucket) {
              bucket.push(job);
              allIds.push(job.msg_id);
            } else {
              console.error(
                `event-queue: unknown handlerType "${job.message?.handlerType}" on msg_id ${job.msg_id}; archiving to dead-letter`
              );
              poisoned.push(job.msg_id);
            }
          }

          return {
            grouped,
            allIds,
            poisoned
          };
        }
      )) as ReadQueueResult;

      if (allIds.length === 0 && poisoned.length === 0) {
        lastPassFull = false;
        break;
      }

      // 2. Archive poisoned messages to pgmq's built-in dead-letter table
      // (pgmq.a_event_system). Archiving dequeues, so these ids are already
      // excluded from the delete-processed list below.
      if (poisoned.length > 0) {
        await step.run(`archive-poisoned-${pass}`, async () => {
          const pg = getJobDatabaseClient();
          await sql`SELECT pgmq.archive(${QUEUE_NAME}, ${poisoned}::bigint[])`.execute(
            pg
          );
        });
        poisonedTotal += poisoned.length;
      }

      // 3. Dispatch webhooks
      if (grouped.WEBHOOK.length > 0) {
        const events = grouped.WEBHOOK.map((job) => ({
          name: "carbon/event-webhook" as const,
          data: {
            msgId: job.msg_id,
            url: job.message.handlerConfig.url,
            companyId: job.message.companyId,
            config: job.message.handlerConfig,
            data: job.message.event
          }
        }));

        const chunks = chunk(events, CHUNK_SIZE);
        for (let i = 0; i < chunks.length; i++) {
          await step.sendEvent(`dispatch-webhooks-${pass}-${i}`, chunks[i]!);
        }
      }

      // 4. Dispatch workflows
      if (grouped.WORKFLOW.length > 0) {
        const events = grouped.WORKFLOW.map((job) => ({
          name: "carbon/event-workflow" as const,
          data: {
            msgId: job.msg_id,
            companyId: job.message.companyId,
            actorId: job.message.actorId ?? null,
            workflowRunId: job.message.workflowRunId ?? null,
            data: job.message.event
          }
        }));

        const chunks = chunk(events, CHUNK_SIZE);
        for (let i = 0; i < chunks.length; i++) {
          await step.sendEvent(`dispatch-workflows-${pass}-${i}`, chunks[i]!);
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
          await step.sendEvent(`dispatch-syncs-${pass}-${i}`, {
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
          await step.sendEvent(`dispatch-searches-${pass}-${i}`, {
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
          await step.sendEvent(`dispatch-audits-${pass}-${i}`, {
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
          await step.sendEvent(`dispatch-embeddings-${pass}-${i}`, {
            name: "carbon/event-embedding" as const,
            data: { records: chunks[i] }
          });
        }
      }

      // 9. Delete processed messages from PGMQ (archived poison ids are
      // excluded — archive already dequeued them)
      if (allIds.length > 0) {
        await step.run(`delete-processed-${pass}`, async () => {
          const pg = getJobDatabaseClient();
          await sql`SELECT pgmq.delete(${QUEUE_NAME}, id::bigint) FROM unnest(${allIds}::bigint[]) AS id`.execute(
            pg
          );
        });
      }

      routed += allIds.length;
      lastPassFull = allIds.length + poisoned.length === BATCH_SIZE;
      if (!lastPassFull) {
        break;
      }
    }

    // Hit MAX_PASSES with a full final batch: hand off to a fresh run rather
    // than growing this one past Inngest's step limit.
    if (lastPassFull) {
      await step.sendEvent("re-wake", {
        name: "carbon/event-queue.process",
        data: {}
      });
    }

    return { routed, poisoned: poisonedTotal };
  }
);
