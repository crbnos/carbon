import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { updatePermissions } from "@carbon/ee/permissions.server";
import { inngest } from "../../client";

// `updatePermissions` (the flattened-permission-object builder) is the licensed
// authoring logic and lives once in `@carbon/ee/permissions.server`. This task
// is just the durable wrapper for the bulk-edit path; it used to carry its own
// drifting copy.
export const updatePermissionsFunction = inngest.createFunction(
  { id: "update-permissions", retries: 3 },
  { event: "carbon/update-permissions" },
  async ({ event, step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const payload = event.data;

    const result = await step.run("update-permissions", async () => {
      logger.info(`Permission Update for ${payload.id}`);
      const { success, message } = await updatePermissions(
        serviceRole,
        payload
      );
      if (success) {
        logger.info(`Permission Update for ${payload.id} succeeded`);
      } else {
        logger.error(`Permission Update for ${payload.id} failed`, {
          message
        });
      }
      return { success, message };
    });

    return result;
  }
);
