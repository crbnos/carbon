// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { type ActionFunctionArgs, data } from "react-router";

const logger = getLogger("erp", "project-wbs-import");

/**
 * Imports a WBS CSV into the project. The rows arrive as JSON (`rows`, parsed
 * in the browser). Intent `preview` reads them and writes nothing; `apply`
 * writes them in one transaction when no row has an error. Refused on a
 * locked plan: import is a setup step (`importProjectWbs`).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const intent = formData.get("intent");
  let rows: Record<string, string | undefined>[];
  try {
    const parsed = JSON.parse(String(formData.get("rows") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("rows is not a list");
    rows = parsed;
  } catch (err) {
    logger.error("The WBS import rows are not valid JSON", {
      projectId,
      error: err
    });
    return data({ success: false, message: "The file could not be read" });
  }

  const api = await carbon(request);
  const imported = await api.projects.importProjectWbs({
    projectId,
    rows,
    apply: intent === "apply"
  });
  if (imported.error) {
    const { category, message } = imported.error;
    // A failed load or a failed import is flashed too; a refusal the modal
    // shows on its own is not.
    if (category === "internal" || category === "notFound") {
      return data(
        { success: false, message },
        await flash(
          request,
          error(
            null,
            category === "internal" ? "Failed to import the WBS" : message
          )
        )
      );
    }
    return data({ success: false, message });
  }
  if (!imported.data.applied) {
    return data({
      success: true,
      applied: false,
      result: imported.data.result
    });
  }
  return data(
    { success: true, applied: true, result: imported.data.result },
    await flash(
      request,
      success(
        `${imported.data.created} created, ${imported.data.updated} updated, ${imported.data.linked} links added`
      )
    )
  );
}
