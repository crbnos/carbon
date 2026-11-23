// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { type ActionFunctionArgs, data } from "react-router";

/**
 * Pins every derived WBS code of the project, as a contractor does at award:
 * afterwards a move keeps each element's code. A plan-layer change: refused
 * on a locked plan.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const api = await carbon(request);
  const result = await api.projects.pinProjectWbsCodes({ projectId });
  if (result.error) {
    return data(
      { success: false, error: { message: result.error.message } },
      await flash(request, error(null, result.error.message))
    );
  }
  return data(
    { success: true },
    await flash(request, success(`${result.data.count} WBS codes pinned`))
  );
}
