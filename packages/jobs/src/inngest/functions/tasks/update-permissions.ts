// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { roundUp } from "@carbon/database/access";
import { updatePermissions } from "@carbon/ee/permissions.server";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

// `updatePermissions` (a person's overrides, as grants) is the licensed
// authoring logic and lives once in `@carbon/ee/permissions.server`. This task
// is just the durable wrapper for the bulk-edit path: one run, and one
// transaction, per person. It runs as the service role, so `updatePermissions`
// authorizes the actor who queued it by their claims; an event with no actor
// writes nothing.
export const updatePermissionsFunction = inngest.createFunction(
  { id: "update-permissions", retries: 3 },
  { event: "carbon/update-permissions" },
  async ({ event, step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const payload = event.data;

    const result = await step.run("update-permissions", async () => {
      logger.info(`Permission Update for ${payload.id}`);
      if (!payload.actorId) {
        logger.error("Permission Update for {payloadId} has no actor", {
          payloadId: payload.id
        });
        return { success: false, message: "No actor to authorize" };
      }
      const grants =
        payload.grants ??
        Object.entries(payload.permissions ?? {}).map(([module, flags]) => ({
          module,
          page: null,
          level: roundUp(flags as Parameters<typeof roundUp>[0])
        }));
      const { success, message } = await updatePermissions(
        serviceRole,
        getJobDatabaseClient(),
        {
          id: payload.id,
          companyId: payload.companyId,
          addOnly: payload.addOnly,
          grants,
          actorId: payload.actorId,
          ip: payload.ip
        }
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
