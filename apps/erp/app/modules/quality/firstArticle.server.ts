import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { createFirstArticleInspections } from "@carbon/database/quality";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";

const logger = getLogger("erp", "first-article");

// AS9102 generation at release: every path that flips a job to Ready calls
// this AFTER the Ready write succeeds — `releaseJobs` (job Release dialog,
// batch and bulk release), the plain `status=Ready` post in
// `$jobId.status.tsx`, and the kanban auto-release. Not inside
// `updateJobStatus`: that is a `*.service.ts` function, which may not hold a
// Kysely client.
//
// Best-effort: a generation failure is logged and never undoes or blocks a
// release. The blocker (a required first article with no plan) is enforced
// BEFORE release by `getJobReleaseReadiness`; what can still fail here is
// infrastructure, and a missed lot can be created by hand from the job.
export async function afterJobsReleased(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  {
    jobIds,
    companyId,
    userId
  }: { jobIds: string[]; companyId: string; userId: string }
): Promise<void> {
  if (jobIds.length === 0) return;

  let today: string;
  try {
    today = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();
  } catch (err) {
    logger.error("Failed to resolve the company timezone for first articles", {
      error: err,
      companyId
    });
    return;
  }

  for (const jobId of jobIds) {
    try {
      const created = await createFirstArticleInspections(db, {
        jobId,
        companyId,
        userId,
        today
      });
      if (created.error) {
        logger.error("Failed to create first article inspections", {
          error: created.error,
          jobId,
          companyId
        });
        continue;
      }

      // Task 21: seed Form 2 rows for created FAIs
      // (created.data.firstArticleInspectionIds)
    } catch (err) {
      logger.error("Failed to create first article inspections", {
        error: err,
        jobId,
        companyId
      });
    }
  }
}
