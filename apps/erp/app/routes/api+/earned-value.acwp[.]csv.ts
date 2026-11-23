// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { buildAcwpExport } from "@carbon/ee/project-control.server";
import { CSV_CONTENT_TYPE, encodeCsvTable } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "earned-value-acwp-csv");

/**
 * GET — the period-closed ACWP of the Direct projects as CSV, for Cobra
 * (Government Contracting 5c, C15). Reads `periodId` (a Closed accounting
 * period) and an optional `projectId`. The ee function reads with the Kysely
 * client, so the permission check is the gate; it also embeds the
 * GOVERNMENT_CONTRACTING entitlement.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects",
    role: "employee"
  });

  const searchParams = new URL(request.url).searchParams;
  const periodId = searchParams.get("periodId");
  const projectId = searchParams.get("projectId") || undefined;
  if (!periodId) {
    throw new Response("Choose an accounting period", { status: 400 });
  }

  let result: Awaited<ReturnType<typeof buildAcwpExport>>;
  try {
    result = await buildAcwpExport(getDatabaseClient(), client, {
      companyId,
      accountingPeriodId: periodId,
      projectId
    });
  } catch (err) {
    if (err instanceof EntitlementError) {
      logger.error("ACWP export refused: not entitled", { companyId });
      throw new Response("Earned value needs an upgraded plan", {
        status: 402
      });
    }
    logger.error("Failed to build the ACWP export", {
      companyId,
      periodId,
      projectId,
      error: err
    });
    throw new Response("Failed to build the ACWP export", { status: 500 });
  }
  if (result.error) {
    logger.error("ACWP export refused", {
      companyId,
      periodId,
      error: result.error
    });
    throw new Response(result.error.message, { status: 400 });
  }

  const { fields, rows, fiscalYear, periodNumber } = result.data;
  return new Response(encodeCsvTable(fields, rows), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="acwp-${fiscalYear}-${periodNumber}.csv"`
    }
  });
}
