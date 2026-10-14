// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import { chunkArray } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getJobReleaseReadiness } from "~/modules/production";
import { releaseJobs } from "~/modules/production/production.server";
import { jobReleaseProblems } from "~/modules/production/ui/Jobs/job-release-logic";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "job-release");

const bodySchema = z.object({ jobIds: z.array(z.string()) });

// Bulk release — the jobs table's "Release Jobs" action. Each selected Draft /
// Planned job goes through the job page's release path (releaseJobs) on its
// own: a job that is not ready is reported in `failed` while the rest still
// release. There is no dialog here, so a job with something to fix or a
// purchase order to choose is skipped and named — the planner releases it from
// the job. A job in any other status (a stale selection) is skipped silently.
// Fetcher-driven; the table toasts the summary and the loader revalidates.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  // A body that is not JSON, or not the shape the table sends, is a plain
  // refusal rather than a 500.
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return { success: false as const, message: "Invalid request" };
  }
  const ids = [...new Set(body.data.jobIds.filter(Boolean))];
  if (ids.length === 0) {
    return { success: false as const, message: "No jobs selected" };
  }

  // An `in` filter rides in the request URL, so a whole page of ids is read in
  // groups.
  const jobs = [];
  for (const batch of chunkArray(ids, 100)) {
    const page = await client
      .from("job")
      .select("id, jobId, status, quantity, scrapQuantity, locationId")
      .in("id", batch)
      .eq("companyId", companyId);
    if (page.error) {
      logger.error("Failed to load the selected jobs", {
        companyId,
        error: page.error
      });
      return {
        success: false as const,
        message: "Failed to load the selected jobs"
      };
    }
    jobs.push(...page.data);
  }

  const releasable = jobs
    .filter((job) => job.status === "Draft" || job.status === "Planned")
    .sort((a, b) => a.jobId.localeCompare(b.jobId));
  const readiness = await getJobReleaseReadiness(
    client,
    releasable.map((job) => job.id),
    companyId
  );
  if (readiness.error || !readiness.data) {
    logger.error("Failed to validate the selected jobs", {
      companyId,
      error: readiness.error
    });
    return {
      success: false as const,
      message: "Failed to validate the selected jobs"
    };
  }

  const readinessByJobId = new Map(
    readiness.data.jobs.map((job) => [job.id, job] as const)
  );
  const suppliersWithDraftPurchaseOrders = new Set(
    readiness.data.suppliers
      .filter((supplier) => supplier.draftPurchaseOrders.length > 0)
      .map((supplier) => supplier.supplierId)
  );
  // Every supplier starts on a new PO; one a job creates is reused by the jobs
  // after it, so the selection lands on one PO per supplier.
  let purchaseOrders: Record<string, string> = Object.fromEntries(
    readiness.data.suppliers.map((supplier) => [supplier.supplierId, "new"])
  );

  let released = 0;
  const failed: { readableId: string; message: string }[] = [];
  // Released, with something left to fix on the job (its purchase orders).
  const warnings: { readableId: string; message: string }[] = [];
  const locationIds = new Set<string>();
  for (const job of releasable) {
    const ready = readinessByJobId.get(job.id);
    const problems = ready
      ? [
          // The job page disables Release for the same job.
          ...(job.quantity === 0 && job.scrapQuantity === 0
            ? ["nothing to make"]
            : []),
          ...jobReleaseProblems(ready),
          ...(ready.supplierIds.some((id) =>
            suppliersWithDraftPurchaseOrders.has(id)
          )
            ? ["choose a purchase order for its outside operations on the job"]
            : [])
        ]
      : ["could not be validated"];
    if (problems.length > 0) {
      failed.push({ readableId: job.jobId, message: problems.join("; ") });
      continue;
    }

    const result = await releaseJobs({
      client,
      db: getDatabaseClient(),
      jobIds: [job.id],
      companyId,
      userId,
      purchaseOrdersBySupplierId: purchaseOrders
    });
    purchaseOrders = result.purchaseOrdersBySupplierId;
    if (result.error) {
      logger.error("Failed to release job", {
        companyId,
        jobId: job.id,
        error: result.error
      });
    }
    // The job is Ready when its id came back released, error or not; a job
    // that is Ready must be scheduled and counted, whatever failed after.
    if (!result.releasedJobIds.includes(job.id)) {
      failed.push({ readableId: job.jobId, message: result.error ?? "" });
      continue;
    }
    if (result.error) {
      warnings.push({ readableId: job.jobId, message: result.error });
    }

    locationIds.add(job.locationId);
    released += 1;
  }

  // After every status flip is persisted — the scheduler only places jobs that
  // are already released. One run per location, as on the job page.
  let scheduled = true;
  for (const locationId of locationIds) {
    try {
      await runLocationSchedule({
        db: getDatabaseClient(),
        client: getCarbonServiceRole(),
        locationId,
        companyId,
        userId
      });
    } catch (error) {
      logger.error("Failed to schedule released jobs", {
        companyId,
        locationId,
        error
      });
      scheduled = false;
    }
  }

  return { success: true as const, released, warnings, failed, scheduled };
}
