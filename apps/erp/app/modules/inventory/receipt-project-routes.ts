// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which purchase order lines of a receipt charge a project, and the account
// their receipt debits instead of inventory, indirect cost or WIP.
// Spec: .ai/specs/2026-10-03-projects.md (Charging: the five entry points).

import type { KyselyDatabase as DB } from "@carbon/database/client";
import type { Kysely } from "kysely";
import {
  assertChargeable,
  isUnallowableCharge,
  loadProjectPostingContexts,
  ProjectChargeError,
  projectPostingKey,
  resolveProjectPostingAccount
} from "~/modules/projects/project-posting";

export type ReceiptProjectRoute = {
  projectId: string;
  projectElementId: string | null;
  /** The project account the receipt debits. */
  accountId: string;
  /** The consume-to-project job of an outside processing line. */
  jobId: string | null;
  /** The asset a Capitalize line builds, else null. */
  fixedAssetId: string | null;
  postCapitalization: boolean;
  /** `isUnallowableCharge` for `accountId`. */
  unallowable: boolean;
};

type RoutablePurchaseOrderLine = {
  id: string;
  jobId: string | null;
  projectId: string | null;
  projectElementId: string | null;
};

/**
 * The project route of each purchase order line, keyed by line id. A line
 * has a route when:
 * - the order is outside processing and the line's job consumes to a project
 *   (the job's project account in place of WIP);
 * - the order is outside processing and the line's job is a capital job
 *   (`loadJobProjectCharge`'s `keepsWip`): the receipt keeps WIP, which the
 *   job's completion sweeps onto its asset, and the route only writes the
 *   project's ledger row, with no CIP row of its own; or
 * - the order is not outside processing and the line carries a project whose
 *   treatment on `postingDate` is not Statistical.
 * A Statistical project keeps today's posting, so it has no route. Every
 * routed line must take postings (`assertChargeable("commitment")`).
 * Three queries at most (the jobs, the posting contexts, and the WIP account
 * for a capital job), never one per line.
 */
export async function loadReceiptProjectRoutes(
  db: Kysely<DB>,
  companyId: string,
  args: {
    purchaseOrderLines: RoutablePurchaseOrderLine[];
    isOutsideProcessing: boolean;
    postingDate: string;
  }
): Promise<Map<string, ReceiptProjectRoute>> {
  const routes = new Map<string, ReceiptProjectRoute>();
  const charges = new Map<
    string,
    {
      projectId: string;
      projectElementId: string | null;
      jobId: string | null;
      capitalJob: boolean;
    }
  >();

  if (args.isOutsideProcessing) {
    const jobIds = [
      ...new Set(
        args.purchaseOrderLines
          .map((line) => line.jobId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (jobIds.length === 0) return routes;
    const jobs = await db
      .selectFrom("job")
      .select(["id", "projectId", "projectElementId", "consumeToProject"])
      .where("id", "in", jobIds)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("consumeToProject", "=", true),
          eb("fixedAssetId", "is not", null)
        ])
      )
      .execute();
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    for (const line of args.purchaseOrderLines) {
      const job = line.jobId ? jobById.get(line.jobId) : undefined;
      if (!job?.projectId) continue;
      charges.set(line.id, {
        projectId: job.projectId,
        projectElementId: job.projectElementId,
        jobId: job.id,
        capitalJob: !job.consumeToProject
      });
    }
  } else {
    for (const line of args.purchaseOrderLines) {
      if (!line.projectId) continue;
      charges.set(line.id, {
        projectId: line.projectId,
        projectElementId: line.projectElementId,
        jobId: null,
        capitalJob: false
      });
    }
  }

  if (charges.size === 0) return routes;

  const contexts = await loadProjectPostingContexts(db, companyId, [
    ...charges.values()
  ]);
  const hasCapitalJob = [...charges.values()].some((c) => c.capitalJob);
  const wipAccount = hasCapitalJob
    ? (
        await db
          .selectFrom("accountDefault")
          .select("workInProgressAccount")
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      )?.workInProgressAccount
    : null;

  for (const [lineId, { capitalJob, ...charge }] of charges) {
    const context = contexts.get(
      projectPostingKey(charge.projectId, charge.projectElementId)
    );
    if (!context) {
      throw new ProjectChargeError(
        "The project or element of a purchase order line does not exist"
      );
    }
    const { treatment, accountId, fixedAssetId, postCapitalization } =
      resolveProjectPostingAccount(context, args.postingDate);
    if (capitalJob) {
      // Not a capital job unless it builds a Capitalize project's asset;
      // its receipt then debits WIP with no project row, as before.
      if (treatment !== "Capitalize") continue;
      if (!wipAccount) {
        throw new Error(
          "workInProgressAccount not configured in account defaults"
        );
      }
      assertChargeable(context, "commitment");
      routes.set(lineId, {
        ...charge,
        accountId: wipAccount,
        fixedAssetId: null,
        postCapitalization: false,
        // The cost ends on the asset the job builds, so its account decides.
        unallowable: isUnallowableCharge(context, accountId)
      });
      continue;
    }
    if (treatment === "Statistical" || !accountId) {
      // A consume-to-project job cannot charge a Statistical project.
      if (charge.jobId) {
        throw new ProjectChargeError(
          "A job cannot consume to a Statistical project"
        );
      }
      continue;
    }
    assertChargeable(context, "commitment");
    routes.set(lineId, {
      ...charge,
      accountId,
      fixedAssetId,
      postCapitalization,
      unallowable: isUnallowableCharge(context, accountId)
    });
  }

  return routes;
}
