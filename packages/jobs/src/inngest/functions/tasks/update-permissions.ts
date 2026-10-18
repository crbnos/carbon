// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { updatePermissions } from "@carbon/ee/permissions.server";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

// `updatePermissions` (a person's overrides, as grants) is the licensed
// authoring logic and lives once in `@carbon/ee/permissions.server`. This task
// is just the durable wrapper for the bulk-edit path: one run, and one
// transaction, per person.
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
        getJobDatabaseClient(),
        { ...payload, actorId: payload.actorId ?? "system" }
      );
      if (success) {
        logger.info(`Permission Update for ${payload.id} succeeded`);
      } else {
        logger.error("Permission Update for {payloadId} failed", {
          payloadId: payload.id,
          message
        });
      }
      return { success, message };
    });

    return result;
  }
);
