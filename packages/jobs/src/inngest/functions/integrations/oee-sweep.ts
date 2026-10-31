// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * OEE sweep — the fallback behind the provider's webhook (`oee-device-sync`).
 * Every 10 minutes it fires one `carbon/oee-sync` per (company, OEE
 * integration) that is active AND has at least one mapped device, so an
 * installed-but-unmapped integration costs nothing. It catches a lost
 * delivery and moves sensor time when a load changes on a running machine.
 * It also registers the webhook of an install made before the provider had
 * one (`registerMissingOeeWebhook`): once, then never again.
 */
import { getIntegrationIdsByRole } from "@carbon/ee";
import { registerMissingOeeWebhook } from "@carbon/ee/oee.server";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

export const oeeSweepFunction = inngest.createFunction(
  { id: "oee-sweep", retries: 2 },
  { cron: "*/10 * * * *" },
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

    const registered = await step.run("register-missing-webhooks", async () => {
      const done: string[] = [];
      for (const target of targets) {
        try {
          if (
            await registerMissingOeeWebhook(
              target.integration,
              target.companyId
            )
          ) {
            done.push(`${target.companyId}/${target.integration}`);
          }
        } catch (error) {
          // The sync still runs on this sweep; the next sweep tries again.
          console.warn(
            `[OEE SWEEP] ${target.companyId}/${target.integration}: webhook not registered`,
            error
          );
        }
      }
      return done;
    });

    return { targets: targets.length, registered };
  }
);
