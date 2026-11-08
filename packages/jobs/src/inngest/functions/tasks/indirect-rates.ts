// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { runIndirectRatePeriod } from "@carbon/ee/indirect-rates.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

/**
 * The indirect rate period run (Government Contracting 5b), sent when an
 * accounting period locks: the Actual rates, the burden catch-up, then the
 * burden billing. A company without GOVERNMENT_CONTRACTING, or with no active
 * pool that applies to projects, is skipped. A business error is recorded on
 * the period's `indirectRateRun` row, not thrown, so it is not retried.
 */
export const indirectRatesFunction = inngest.createFunction(
  {
    id: "indirect-rates",
    concurrency: { key: "event.data.companyId", limit: 1 },
    retries: 2
  },
  { event: "carbon/indirect-rates.compute" },
  async ({ event, step, logger }) => {
    const { companyId, accountingPeriodId, userId } = event.data;

    const entitled = await step.run("check-feature", () =>
      companyHasFeature(getCarbonServiceRole(), companyId, {
        feature: "GOVERNMENT_CONTRACTING"
      })
    );
    if (!entitled) return { skipped: "not entitled" };

    const pools = await step.run("check-pools", async () => {
      const row = await getJobDatabaseClient()
        .selectFrom("indirectPool")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("companyId", "=", companyId)
        .where("active", "=", true)
        .where("appliesToProjects", "=", true)
        .executeTakeFirst();
      return Number(row?.count ?? 0);
    });
    if (pools === 0) return { skipped: "no pools" };

    return step.run("run", async () => {
      const result = await runIndirectRatePeriod(
        getJobDatabaseClient(),
        getCarbonServiceRole(),
        { companyId, accountingPeriodId, userId }
      );
      if (result.error) {
        logger.error("Indirect rate run failed for {companyId}", {
          companyId,
          accountingPeriodId,
          message: result.error.message
        });
      }
      return result;
    });
  }
);
