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
      limit: 0,
      key: "event.data.companyId"
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
