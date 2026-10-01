// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAssemblyInstructionStep } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { stepId } = params;
  if (!stepId) throw new Error("stepId is not found");

  const deleteStep = await deleteAssemblyInstructionStep(client, stepId);
  if (deleteStep.error) {
    return data(
      {
        success: false
      },
      await flash(request, error(deleteStep.error, "Failed to delete step"))
    );
  }

  return data(
    {
      success: true
    },
    await flash(request, success("Successfully deleted step"))
  );
}
