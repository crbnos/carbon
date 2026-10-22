// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { type ActionFunctionArgs, data } from "react-router";

/**
 * Clears the pinned WBS codes of an element (`elementId`) and its subtree, so
 * they derive from the tree again. A plan-layer change: refused on a locked
 * plan.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const elementId = String(formData.get("elementId") ?? "");
  if (!elementId) {
    return data(
      { success: false },
      await flash(request, error(null, "Choose an element"))
    );
  }

  const api = await carbon(request);
  const result = await api.projects.renumberProjectWbsSubtree({
    projectId,
    elementId
  });
  if (result.error) {
    return data(
      { success: false, error: { message: result.error.message } },
      await flash(request, error(null, result.error.message))
    );
  }
  return data(
    { success: true },
    await flash(request, success(`${result.data.count} WBS codes unpinned`))
  );
}
