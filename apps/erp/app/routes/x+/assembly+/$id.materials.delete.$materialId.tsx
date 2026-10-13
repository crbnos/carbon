// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAssemblyInstructionStepMaterial } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { materialId } = params;
  if (!materialId) throw new Error("materialId is not found");

  const deleteMaterial = await deleteAssemblyInstructionStepMaterial(
    client,
    materialId
  );
  if (deleteMaterial.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(deleteMaterial.error, "Failed to delete material")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Successfully deleted material"))
  );
}
