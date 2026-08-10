import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

/**
 * Unified scheduling function that handles both initial scheduling and rescheduling.
 * Uses the new unified scheduling engine endpoint.
 */
export const rescheduleJobFunction = inngest.createFunction(
  {
    id: "schedule-job",
    retries: 3,
    concurrency: {
      // One scheduling run at a time per company — capacity reservations are
      // cross-job, so concurrent runs could double-book a work center.
      // env scope + the shared "schedule:" key serializes with the
      // schedule-replan-wave function, not just other runs of this one.
      // (a zero limit is zero capacity: runs queue forever and never execute.)
      limit: 1,
      scope: "env",
      key: '"schedule:" + event.data.companyId'
    }
  },
  { event: "carbon/reschedule-job" },
  async ({ event, step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const {
      jobId,
      companyId,
      userId,
      mode = "reschedule",
      direction = "backward"
    } = event.data;

    const result = await step.run("schedule-job", async () => {
      logger.info(
        `${mode === "initial" ? "Scheduling" : "Rescheduling"} job ${jobId}`
      );

      try {
        const { data, error } = await serviceRole.functions.invoke("schedule", {
          body: {
            jobId,
            companyId,
            userId,
            mode,
            direction
          }
        });

        if (error) {
          throw new Error(error.message || `Failed to ${mode} schedule job`);
        }

        logger.info(
          `${mode === "initial" ? "Scheduled" : "Rescheduled"}: ` +
            `${data.operationsScheduled} ops, ` +
            `${data.workCentersAffected.length} WCs, ` +
            `${data.conflictsDetected} conflicts`
        );

        return {
          success: true,
          operationsScheduled: data.operationsScheduled,
          conflictsDetected: data.conflictsDetected,
          workCentersAffected: data.workCentersAffected,
          assemblyDepth: data.assemblyDepth
        };
      } catch (error) {
        logger.error(
          `${mode === "initial" ? "Scheduling" : "Rescheduling"} failed`,
          { error }
        );
        throw error; // Let Inngest handle retries
      }
    });

    return result;
  }
);
