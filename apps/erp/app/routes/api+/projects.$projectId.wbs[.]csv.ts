// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import {
  toWbsCsvRows,
  WBS_CSV_COLUMNS
} from "~/modules/projects/projects.models";
import { loadWbsElements } from "~/modules/projects/projects.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-wbs-csv");

/**
 * GET — a project's WBS as CSV: one row per numbered element, in tree order,
 * with its code, parent code, dates, budget and predecessors. The import
 * reads the same columns back. Refused with 422 while 2 elements share a
 * code.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects",
    role: "employee"
  });
  const { projectId } = params;
  if (!projectId)
    throw new Response("The project could not be found", { status: 404 });

  const project = await client
    .from("project")
    .select("identifier, name")
    .eq("id", projectId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (project.error || !project.data) {
    logger.error("Failed to load the project", {
      companyId,
      projectId,
      error: project.error
    });
    throw new Response("The project could not be found", { status: 404 });
  }

  const { elements, links } = await loadWbsElements(getDatabaseClient(), {
    companyId,
    projectId
  });

  let rows: ReturnType<typeof toWbsCsvRows>;
  try {
    rows = toWbsCsvRows(elements, links);
  } catch (err) {
    logger.error("The WBS has repeated codes", {
      companyId,
      projectId,
      error: err
    });
    throw new Response(
      err instanceof Error ? err.message : "The WBS has repeated codes",
      { status: 422 }
    );
  }

  const fileName = `${project.data.identifier ?? "project"}-wbs.csv`;
  return new Response(encodeCsv(rows, { fields: [...WBS_CSV_COLUMNS] }), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}
