import { getJobDatabaseClient } from "../../../db";
import {
  bookChain,
  chainIsStale,
  dispatchDue,
  MAX_DUE_PER_WAKE,
  ownsChain,
  planWakeAt,
  scanDue
} from "../../../workflows/scheduler";
import { inngest } from "../../client";

export const workflowSchedulerFunction = inngest.createFunction(
  {
    id: "workflows-scheduler",
    retries: 3,
    // Never two wakes at once. Combined with the Redis chain token, a duplicate chain
    // converges back to one instead of multiplying.
    singleton: { key: "workflows-scheduler", mode: "skip" }
  },
  { event: "carbon/workflow-scheduler.wake" },
  async ({ event, step, logger }) => {
    const owns = await step.run("own-chain", () =>
      ownsChain(event.data.bookedFor ?? null)
    );
    if (!owns) return { skipped: "superseded chain" };

    const scan = await step.run("scan", async () => {
      const db = getJobDatabaseClient();
      const now = new Date();
      const { due, earliestFuture } = await scanDue(db, now);
      return {
        dueCount: due.length,
        earliestFuture: earliestFuture ? earliestFuture.toISOString() : null
      };
    });

    // planWakeAt runs inside the step so `wakeAt` is memoized. Without this, a retry
    // after book-chain completes but before sendEvent would recompute a different wakeAt,
    // leaving Redis holding a value that the outgoing event's bookedFor doesn't match →
    // ownsChain returns false on the next wake → chain silently dies.
    const wakeAt = await step.run("book-chain", async () => {
      const wakeAtMs = planWakeAt({
        now: new Date(),
        earliestFuture: scan.earliestFuture
          ? new Date(scan.earliestFuture)
          : null,
        overflow: scan.dueCount === MAX_DUE_PER_WAKE
      });
      await bookChain(wakeAtMs);
      return wakeAtMs;
    });
    await step.sendEvent("book-next-wake", {
      name: "carbon/workflow-scheduler.wake",
      ts: wakeAt,
      data: { bookedFor: wakeAt }
    });

    const result = await step.run("dispatch", () =>
      dispatchDue(getJobDatabaseClient(), new Date())
    );

    if (result.events.length > 0) {
      await step.sendEvent("queue-runs", result.events);
    }

    logger.info("workflow scheduler tick", {
      queued: result.queued,
      skipped: result.skipped
    });

    return { queued: result.queued, skipped: result.skipped };
  }
);

/** The only static timer we own. It does nothing but revive a chain that has gone quiet. */
export const workflowSchedulerBackstopFunction = inngest.createFunction(
  { id: "workflows-scheduler-backstop", retries: 2 },
  { cron: "0 * * * *" },
  async ({ step, logger }) => {
    const stale = await step.run("check-chain", () => chainIsStale(new Date()));
    if (!stale) return { revived: false };
    await step.sendEvent("revive-chain", {
      name: "carbon/workflow-scheduler.wake",
      data: { bookedFor: null }
    });
    logger.info("workflow scheduler backstop revived chain");
    return { revived: true };
  }
);
