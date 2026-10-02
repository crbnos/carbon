// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import invariant from "tiny-invariant";
import { deleteRisk } from "~/modules/quality/quality.service";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const result = await deleteRisk(client, id);

  if (result.error) {
    return data(
      {
        success: false,
        message: "Failed to delete risk"
      },
      { status: 500 }
    );
  }

  return data({
    success: true,
    message: "Risk deleted successfully"
  });
};
