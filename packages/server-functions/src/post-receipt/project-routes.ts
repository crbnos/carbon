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
} from "../lib/project-posting";

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
 *   (the job's project account in place of WIP); or
 * - the order is not outside processing and the line carries a project whose
 *   treatment on `postingDate` is not Statistical.
 * A Statistical project keeps today's posting, so it has no route. Every
 * routed line must take postings (`assertChargeable("commitment")`).
 * Two queries at most (the jobs, then the posting contexts), never one per
 * line.
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
    { projectId: string; projectElementId: string | null; jobId: string | null }
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
      .select(["id", "projectId", "projectElementId"])
      .where("id", "in", jobIds)
      .where("companyId", "=", companyId)
      .where("consumeToProject", "=", true)
      .execute();
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    for (const line of args.purchaseOrderLines) {
      const job = line.jobId ? jobById.get(line.jobId) : undefined;
      if (!job?.projectId) continue;
      charges.set(line.id, {
        projectId: job.projectId,
        projectElementId: job.projectElementId,
        jobId: job.id
      });
    }
  } else {
    for (const line of args.purchaseOrderLines) {
      if (!line.projectId) continue;
      charges.set(line.id, {
        projectId: line.projectId,
        projectElementId: line.projectElementId,
        jobId: null
      });
    }
  }

  if (charges.size === 0) return routes;

  const contexts = await loadProjectPostingContexts(db, companyId, [
    ...charges.values()
  ]);

  for (const [lineId, charge] of charges) {
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
