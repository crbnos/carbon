// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { chunkArray, Edition } from "@carbon/utils";
import { inngest } from "../../client";
import {
  deleteCompanies,
  inactiveCompanyOwner,
  loadInactiveCompanies
} from "./company-cleanup";

/** Ten companies a step, so this stays well under Inngest's per-run step limit. */
const MAX_COMPANIES_PER_RUN = 500;

/**
 * Only `dryRun: false` deletes: a missing payload, a typo or any other value is
 * a dry run. `limit` is clamped to 0..500, whole companies.
 */
export function resolvePurgeOptions(data: {
  dryRun?: unknown;
  limit?: unknown;
}): { dryRun: boolean; limit: number } {
  const requested =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? Math.trunc(data.limit)
      : MAX_COMPANIES_PER_RUN;
  return {
    dryRun: data?.dryRun !== false,
    limit: Math.min(Math.max(requested, 0), MAX_COMPANIES_PER_RUN)
  };
}

/**
 * A run started with the Invoke button of the Inngest dashboard (or dev server)
 * arrives as this event. Inngest reserves the `inngest/` prefix, so it cannot
 * be sent through the event API.
 */
const INVOKED = "inngest/function.invoked";

/**
 * Why a run must not purge, or null when it may. Cloud only: a self-hosted
 * install has no plans, so every company there reads as inactive. And only a
 * run someone started from the Inngest dashboard: a
 * `carbon/purge-inactive-companies` event sent with the event key is refused.
 */
export function purgeRefusal(
  eventName: string,
  edition: string | undefined
): string | null {
  if (edition !== Edition.Cloud) return "not Carbon Cloud";
  if (eventName !== INVOKED) return "not invoked from the Inngest dashboard";
  return null;
}

/**
 * Delete inactive companies now, with no warning email and no waiting period.
 * Run by hand with the Invoke button of the Inngest dashboard, on Carbon Cloud;
 * nothing schedules it and nothing else can start it (`purgeRefusal`).
 *
 * "Inactive" is the weekly cleanup's rule and nothing looser: no plan anywhere
 * in the group, older than a week, not a bypass company, and not owned by a
 * Carbon or bypass user. What it skips is the warning: the weekly job deletes
 * only a company whose owner was emailed a date, and this does not ask.
 *
 * `dryRun` defaults to TRUE. A deleted company cannot be brought back, and an
 * Invoke with an empty payload must not be what deletes five hundred of them:
 * the run then returns the companies it would delete, oldest first. Send
 * `{ "dryRun": false }` to delete; `limit` (at most 500) caps one run.
 */
export const purgeInactiveCompaniesFunction = inngest.createFunction(
  {
    id: "purge-inactive-companies",
    retries: 0,
    concurrency: { limit: 1 }
  },
  { event: "carbon/purge-inactive-companies" },
  async ({ event, step, logger }) => {
    const refused = purgeRefusal(event.name, process.env.CARBON_EDITION);
    if (refused) {
      logger.warn("Inactive company purge refused", { reason: refused });
      return { deleted: 0, reason: refused };
    }
    const { dryRun, limit } = resolvePurgeOptions(event.data);

    const plan = await step.run("plan-inactive-company-purge", async () => {
      const found = await loadInactiveCompanies(logger);
      if (!found) return null;
      return {
        inactive: found.inactive.length,
        withoutOwner: found.inactive.length - found.deletable.length,
        targets: found.deletable
          .slice(0, limit)
          .map(({ id, name, companyGroupId, createdAt }) => ({
            id,
            name,
            companyGroupId,
            createdAt
          }))
      };
    });
    if (!plan) return { dryRun, deleted: 0, reason: "nothing loaded" };

    const summary = {
      dryRun,
      inactive: plan.inactive,
      withoutOwner: plan.withoutOwner,
      selected: plan.targets.length
    };
    if (dryRun) {
      logger.info("Inactive company purge (dry run)", summary);
      return { ...summary, deleted: 0, companies: plan.targets };
    }

    let deleted = 0;
    const kept: string[] = [];
    const batches = chunkArray(plan.targets, 10);
    for (let i = 0; i < batches.length; i++) {
      try {
        // Re-checked in the purge's own transaction: a plan bought since the
        // list was built must stop the delete.
        const results = await step.run(`purge-inactive-companies-${i}`, () =>
          deleteCompanies(
            batches[i]!,
            async (trx, companyId) =>
              (await inactiveCompanyOwner(trx, companyId)) !== null,
            logger
          )
        );
        for (const result of results) {
          if (result.deleted) deleted++;
          else kept.push(result.id);
        }
      } catch (error) {
        logger.error("Failed to purge a batch of inactive companies", {
          batch: i,
          error
        });
        kept.push(...batches[i]!.map((company) => company.id));
      }
    }

    logger.info("Inactive company purge", { ...summary, deleted, kept });
    return { ...summary, deleted, kept };
  }
);
