// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { ICE_SCHEDULES } from "@carbon/ee/indirect-rates";
import { buildIceSchedule } from "@carbon/ee/indirect-rates.server";
import { CSV_CONTENT_TYPE, encodeCsvTable } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "indirect-rates-ice-csv");

const iceQuery = z.object({
  fiscalYear: z.coerce.number().int().min(1900).max(9999),
  schedule: z.enum(ICE_SCHEDULES)
});

/**
 * GET — one Incurred Cost Electronic (ICE) schedule of a fiscal year as CSV
 * (`?fiscalYear=2026&schedule=H`). The schedule reads with the Kysely client,
 * so the permission check is the gate. Without GOVERNMENT_CONTRACTING it
 * answers 402.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const searchParams = new URL(request.url).searchParams;
  const query = iceQuery.safeParse({
    fiscalYear: searchParams.get("fiscalYear"),
    schedule: searchParams.get("schedule")
  });
  if (!query.success) {
    throw new Response("Choose a fiscal year and an ICE schedule", {
      status: 400
    });
  }
  const { fiscalYear, schedule } = query.data;

  let table: Awaited<ReturnType<typeof buildIceSchedule>>;
  try {
    table = await buildIceSchedule(getDatabaseClient(), client, {
      companyId,
      fiscalYear,
      schedule
    });
  } catch (error) {
    if (error instanceof EntitlementError) {
      return new Response("Upgrade required", { status: 402 });
    }
    logger.error("Failed to build an ICE schedule", {
      companyId,
      fiscalYear,
      schedule,
      error
    });
    throw new Response("Failed to export the ICE schedule", { status: 500 });
  }

  return new Response(encodeCsvTable(table.fields, table.rows), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="ice-${fiscalYear}-schedule-${schedule}.csv"`
    }
  });
}
