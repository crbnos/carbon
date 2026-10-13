// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getProject } from "~/modules/projects";
import {
  importProjectWbs,
  requireEditablePlanRoute
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-wbs-import");

/** The largest file the import reads, in rows. */
const MAX_ROWS = 5000;

/**
 * Imports a WBS CSV into the project. The rows arrive as JSON (`rows`, parsed
 * in the browser). Intent `preview` reads them and writes nothing; `apply`
 * writes them in one transaction when no row has an error. Refused on a
 * locked plan: import is a setup step.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // A row without an Element ID creates an element, as New element does.
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "projects",
    update: "projects"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const project = await getProject(client, companyId, projectId);
  if (project.error || !project.data) {
    logger.error("Failed to load project", {
      companyId,
      projectId,
      error: project.error
    });
    return data(
      { success: false, message: "Failed to load the project" },
      await flash(request, error(project.error, "Failed to load the project"))
    );
  }
  if (project.data.status === "Closed") {
    return data({ success: false, message: "A Closed project cannot change" });
  }

  const locked = await requireEditablePlanRoute(request, {
    client,
    projectId,
    companyId,
    changeRequestId: null,
    withFlash: false
  });
  if (locked) return locked;

  const formData = await request.formData();
  const intent = formData.get("intent");
  let rows: Record<string, string | undefined>[];
  try {
    const parsed = JSON.parse(String(formData.get("rows") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("rows is not a list");
    rows = parsed;
  } catch (err) {
    logger.error("The WBS import rows are not valid JSON", {
      companyId,
      projectId,
      error: err
    });
    return data({ success: false, message: "The file could not be read" });
  }
  if (rows.length === 0) {
    return data({ success: false, message: "The file has no rows" });
  }
  if (rows.length > MAX_ROWS) {
    return data({
      success: false,
      message: `The file has more than ${MAX_ROWS} rows`
    });
  }

  try {
    const imported = await importProjectWbs(getDatabaseClient(), {
      companyId,
      userId,
      projectId,
      rows,
      apply: intent === "apply"
    });
    if (!imported.applied) {
      return data({ success: true, applied: false, result: imported.result });
    }
    return data(
      { success: true, applied: true, result: imported.result },
      await flash(
        request,
        success(
          `${imported.created} created, ${imported.updated} updated, ${imported.linked} links added`
        )
      )
    );
  } catch (err) {
    logger.error("Failed to import the WBS", {
      companyId,
      projectId,
      error: err
    });
    return data(
      {
        success: false,
        message: err instanceof Error ? err.message : "Failed to import the WBS"
      },
      await flash(request, error(err, "Failed to import the WBS"))
    );
  }
}
