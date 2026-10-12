// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteProcedureParameter } from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "production"
  });

  const { parameterId } = params;

  if (!parameterId) throw new Error("parameterId is not found");

  const deleteParameter = await deleteProcedureParameter(
    client,
    parameterId,
    companyId
  );
  if (deleteParameter.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(deleteParameter.error, "Failed to delete parameter")
      )
    );
  }

  return data(
    {
      success: true
    },
    await flash(request, success("Successfully deleted parameter"))
  );
}
