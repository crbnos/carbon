// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * OEE sweep — OEE providers have no webhooks, so this poll is the only way
 * machine state reaches Carbon. Every 2 minutes it fires one `carbon/oee-sync`
 * per (company, OEE integration) that is active AND has at least one mapped
 * device, so an installed-but-unmapped integration costs nothing.
 */
import { getIntegrationIdsByRole } from "@carbon/ee";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

export const oeeSweepFunction = inngest.createFunction(
  { id: "oee-sweep", retries: 2 },
  { cron: "*/2 * * * *" },
  async ({ step }) => {
    const targets = await step.run("find-oee-sync-targets", async () => {
      const integrationIds = getIntegrationIdsByRole("oee");
      if (integrationIds.length === 0) return [];
      return getJobDatabaseClient()
        .selectFrom("workCenterDevice")
        .innerJoin("companyIntegration", (join) =>
          join
            .onRef("companyIntegration.id", "=", "workCenterDevice.integration")
            .onRef(
              "companyIntegration.companyId",
              "=",
              "workCenterDevice.companyId"
            )
        )
        .where("companyIntegration.active", "=", true)
        .where("workCenterDevice.integration", "in", integrationIds)
        .select(["workCenterDevice.companyId", "workCenterDevice.integration"])
        .distinct()
        .execute();
    });

    if (targets.length === 0) return { targets: 0 };

    await step.sendEvent(
      "dispatch-oee-sync",
      targets.map((target) => ({
        name: "carbon/oee-sync" as const,
        data: {
          companyId: target.companyId,
          integrationId: target.integration
        }
      }))
    );

    return { targets: targets.length };
  }
);
