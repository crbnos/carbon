// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Mount daily sweep. Customers, suppliers and parts created or edited in
 * Carbon reach Mount without anyone pressing Push.
 *
 * Once a day it lists each company with an ACTIVE Mount integration and fires
 * one `carbon/mount-publish` event per company for every entity type
 * (`trigger: "schedule"`). The publish run is idempotent and serialised per
 * company, so a sweep landing on a manual run waits behind it.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { MOUNT_INTEGRATION_ID } from "@carbon/ee/mount";
import { inngest } from "../../client";

export const mountSweepFunction = inngest.createFunction(
  { id: "mount-sweep", retries: 2 },
  { cron: "30 2 * * *" }, // daily, 02:30 UTC
  async ({ step }) => {
    const companyIds = await step.run("find-mount-sweep-targets", async () => {
      const { data, error } = await getCarbonServiceRole()
        .from("companyIntegration")
        .select("companyId")
        .eq("id", MOUNT_INTEGRATION_ID)
        .eq("active", true);

      if (error) {
        throw new Error(`Failed to list Mount integrations: ${error.message}`);
      }

      return (data ?? []).map((row) => row.companyId);
    });

    if (companyIds.length === 0) {
      return { targets: 0 };
    }

    await step.sendEvent(
      "dispatch-mount-publish",
      companyIds.map((companyId) => ({
        name: "carbon/mount-publish" as const,
        data: { companyId, trigger: "schedule" as const }
      }))
    );

    return { targets: companyIds.length };
  }
);
