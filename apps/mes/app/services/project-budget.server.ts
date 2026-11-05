// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { checkTimesheetBudget } from "@carbon/ee/project-control.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

const logger = getLogger("mes", "project-budget");

/**
 * The budget warning of a saved timesheet entry (Government Contracting 5c).
 * A timesheet is never refused for budget (DCAAM 7641.90): the entry is
 * already saved, so this returns the overrun text or null, and sends the
 * `ProjectBudgetExceeded` notice to the owner of each Block project. Any
 * failure is logged and returns null, so it never fails the entry. The ERP
 * twin is `timesheetBudgetWarning` in `projects.server.ts`.
 */
export async function timesheetBudgetWarning(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    projectId: string;
    projectElementId?: string | null;
    laborCategoryId: string;
    entryDate: string;
    hours: number;
  }
): Promise<string | null> {
  try {
    const budget = await checkTimesheetBudget(db, client, {
      ...args,
      projectElementId: args.projectElementId || null
    });
    for (const notice of budget.notices) {
      try {
        await trigger("notify", {
          event: NotificationEvent.ProjectBudgetExceeded,
          companyId: args.companyId,
          documentId: notice.projectId,
          recipient: { type: "user", userId: notice.ownerId },
          title: notice.title,
          body: notice.body
        });
      } catch (err) {
        logger.error("Failed to send the budget exceeded notice", {
          companyId: args.companyId,
          projectId: notice.projectId,
          error: err
        });
      }
    }
    return budget.status === "warn" ? budget.message : null;
  } catch (err) {
    logger.error("Failed to check the timesheet budget", {
      companyId: args.companyId,
      projectId: args.projectId,
      error: err
    });
    return null;
  }
}
