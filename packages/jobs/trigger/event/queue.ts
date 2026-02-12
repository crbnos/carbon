import {
  getPostgresClient,
  getPostgresConnectionPool,
  KyselyDatabase,
} from "@carbon/database/client";
import { HandlerType, QueueMessage } from "@carbon/database/event";
import { all } from "@carbon/utils";
import { schedules } from "@trigger.dev/sdk";
import { Kysely, PostgresDriver, sql } from "kysely";
import { auditTask } from "./audit.ts";
import { searchTask } from "./search.ts";
import { syncTask } from "./sync.ts";
import { webhookTask } from "./webhook.ts";
import { workflowDispatchTask } from "./workflow.ts";

const QUEUE_NAME = "event_system"; // Name of the PGMQ queue
const BATCH_SIZE = 250; // Number of messages to process per run
const VISIBILITY_TIMEOUT = 30; // Seconds a message is hidden after being read

const getDatabaseClient = (size: number) => {
  const pool = getPostgresConnectionPool(size);
  return getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
};

const pg = getDatabaseClient(1);

type QueueJob = {
  msg_id: number;
  message: QueueMessage;
};

export const eventQueueTask = schedules.task({
  id: "event-queue",
  description: "Polls PGMQ and routes events",
  cron: "* * * * *",
  retry: {
    maxAttempts: 2,
    randomize: true,
  },
  async run() {
    // 1. Read Batch (PGMQ returns these sorted by ID/Time)
    const { rows: jobs } =
      await sql<QueueJob>`SELECT * FROM pgmq.read(${QUEUE_NAME}, ${VISIBILITY_TIMEOUT}, ${BATCH_SIZE})`.execute(
        pg
      );

    if (jobs.length === 0) return { processed: 0 };

    let total: number[] = [];

    // Arrays for batching
    const grouped: Record<HandlerType, QueueJob[]> = {
      WEBHOOK: [],
      WORKFLOW: [],
      SYNC: [],
      SEARCH: [],
      AUDIT: [],
    };

    // 2. Sort into Buckets
    for (const job of jobs) {
      grouped[job.message.handlerType].push(job);
    }

    const { webhooks, syncs, workflows, searches, audits } = await all({
      async webhooks() {
        let queue: number[] = [];

        if (grouped.WEBHOOK.length === 0) return queue;

        const tasks = grouped.WEBHOOK.map((job) => {
          const event = job.message.event;
          queue.push(job.msg_id);

          return {
            payload: {
              url: job.message.handlerConfig.url,
              config: job.message.handlerConfig,
              data: event,
            },
            options: {
              idempotencyKey: `wh_${job.msg_id}`,
              // This tells Trigger.dev: "Queue this, but don't run it until
              // any previous tasks for this specific record are finished."
              concurrencyKey: `record_${event.table}_${event.recordId}`,
            },
          };
        });

        await webhookTask.batchTrigger(tasks);

        return queue;
      },
      async workflows() {
        let queue: number[] = [];

        if (grouped.WORKFLOW.length === 0) return queue;

        const tasks = grouped.WORKFLOW.map((job) => {
          const event = job.message.event;
          queue.push(job.msg_id);

          return {
            payload: {
              workflowId: job.message.handlerConfig.workflowId,
              data: event,
            },
            options: {
              idempotencyKey: `wf_${job.msg_id}`,
              concurrencyKey: `record_${event.table}_${event.recordId}`,
            },
          };
        });

        await workflowDispatchTask.batchTrigger(tasks);

        return queue;
      },
      async syncs() {
        let queue: number[] = [];

        if (grouped.SYNC.length === 0) return queue;

        const records = grouped.SYNC.map((job) => {
          queue.push(job.msg_id);

          return {
            event: job.message.event,
            companyId: job.message.companyId,
            handlerConfig: job.message.handlerConfig,
          };
        });

        await syncTask.trigger({
          records,
        });

        return queue;
      },
      async searches() {
        let queue: number[] = [];

        if (grouped.SEARCH.length === 0) return queue;

        const records = grouped.SEARCH.map((job) => {
          queue.push(job.msg_id);

          return {
            event: job.message.event,
            companyId: job.message.companyId,
          };
        });

        await searchTask.trigger({
          records,
        });

        return queue;
      },
      async audits() {
        let queue: number[] = [];

        if (grouped.AUDIT.length === 0) return queue;

        const records = grouped.AUDIT.map((job) => {
          queue.push(job.msg_id);

          return {
            event: job.message.event,
            companyId: job.message.companyId,
            actorId: job.message.actorId,
            handlerConfig: job.message.handlerConfig,
          };
        });

        await auditTask.trigger({
          records,
        });

        return queue;
      },
    });

    total = total.concat(webhooks, workflows, syncs, searches, audits);

    // 5. Delete from PGMQ
    // We delete immediately because we have successfully offloaded
    // the ordering responsibility to Trigger.dev's internal queue.
    if (total.length > 0) {
      await sql`SELECT pgmq.delete(${QUEUE_NAME}, id::bigint) FROM unnest(${total}::bigint[]) AS id`.execute(
        pg
      );
    }

    return { routed: total.length };
  },
});
