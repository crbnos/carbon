// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { runLocationSchedule } from "@carbon/planning";
import { serverFns } from "@carbon/server-functions";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

export const recalculateFunction = inngest.createFunction(
  { id: "recalculate", retries: 3 },
  { event: "carbon/recalculate" },
  async ({ event, step, logger }) => {
    const payload = event.data;

    const result = await step.run("recalculate", async () => {
      logger.info(`Type: ${payload.type}, id: ${payload.id}`);

      const serviceRole = getCarbonServiceRole();

      switch (payload.type) {
        case "jobRequirements": {
          logger.info(`Recalculating job requirements for ${payload.id}`);
          const calculateQuantities = await recalculateJobRequirements({
            id: payload.id,
            companyId: payload.companyId,
            userId: payload.userId
          });

          return {
            success: !calculateQuantities.error,
            message: calculateQuantities.error?.message
          };
        }
        case "jobMakeMethodRequirements": {
          logger.info(
            `Recalculating job make method requirements for ${payload.id}`
          );
          const { error: rescheduleError } =
            await recalculateJobMakeMethodRequirements(serviceRole, {
              id: payload.id,
              companyId: payload.companyId,
              userId: payload.userId
            });

          return {
            success: !rescheduleError,
            message: rescheduleError?.message
          };
        }

        default:
          return {
            success: false,
            message: `Unknown recalculation type: ${payload.type}`
          };
      }
    });

    if (result.success) {
      logger.info(`Success ${payload.id}`);
    } else {
      logger.error(`Recalculation ${payload.type} failed for ${payload.id}`, {
        message: result.message
      });
    }

    return result;
  }
);

async function recalculateJobRequirements(params: {
  id: string;
  companyId: string;
  userId: string;
}) {
  return serverFns
    .system({
      db: getJobDatabaseClient(),
      companyId: params.companyId,
      userId: params.userId
    })
    .invoke("recalculate", { type: "jobRequirements", id: params.id });
}

async function recalculateJobMakeMethodRequirements(
  client: ReturnType<typeof getCarbonServiceRole>,
  params: {
    id: string;
    companyId: string;
    userId: string;
  }
): Promise<{ error: Error | null }> {
  // Forecast-first scheduling regenerates the WHOLE LOCATION; resolve the job's
  // location and regenerate it IN-PROCESS (Node).
  const { data: job, error } = await client
    .from("job")
    .select("locationId")
    .eq("id", params.id)
    .eq("companyId", params.companyId)
    .single();
  if (error || !job?.locationId) {
    return {
      error: error ? new Error(error.message) : new Error("Job has no location")
    };
  }
  try {
    await runLocationSchedule({
      db: getJobDatabaseClient(),
      client,
      locationId: job.locationId,
      companyId: params.companyId,
      userId: params.userId
    });
    return { error: null };
  } catch (err) {
    return {
      error: err instanceof Error ? err : new Error("Failed to reschedule")
    };
  }
}
