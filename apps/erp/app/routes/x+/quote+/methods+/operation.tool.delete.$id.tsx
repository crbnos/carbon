// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteQuoteOperationTool } from "~/modules/sales";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationTool = await deleteQuoteOperationTool(client, id);
  if (deleteOperationTool.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationTool.error,
          "Failed to delete quote operation tool"
        )
      )
    );
  }

  return {};
}
