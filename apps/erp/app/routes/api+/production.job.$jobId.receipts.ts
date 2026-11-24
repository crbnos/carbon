// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  getJobReceiptHolds,
  getJobReceiptPreview
} from "~/modules/production/production.service";
import { getDatabaseClient } from "~/services/database.server";

/**
 * Read candidate units, stock movements and Quality's hold explanations from
 * one snapshot when the dialog opens. The production permission above lets
 * users see this receipt without requiring access to the entire ledger.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  return getDatabaseClient()
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (db) => {
      const preview = await getJobReceiptPreview(db, jobId, companyId);
      if (!preview) return { receipts: null };
      const settings = await db
        .selectFrom("companySettings")
        .select("holdUnitsWithOpenIssues")
        .where("id", "=", companyId)
        .executeTakeFirst();
      return {
        receipts: {
          ...preview,
          qualityHoldsEnabled: settings?.holdUnitsWithOpenIssues ?? false,
          holds: await getJobReceiptHolds(db, jobId, companyId)
        }
      };
    });
}
