// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const supplierId = formData.get("supplierId") as string;
  const table = formData.get("table") as string;

  if (!id) {
    return data(
      { success: false },
      await flash(request, error(null, "Task ID is required"))
    );
  }

  if (!table) {
    return data(
      { success: false },
      await flash(request, error(null, "Table is required"))
    );
  }

  if (table !== "nonConformanceActionTask") {
    return data(
      { success: false },
      await flash(request, error(null, "Invalid table"))
    );
  }

  const result = await client
    .from(table)
    .update({
      supplierId: supplierId || null,
      updatedBy: userId
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, "Failed to update task supplier")
      )
    );
  }

  if (!result.data) {
    return data(
      { success: false },
      await flash(request, error(null, "Task not found"))
    );
  }

  return { success: true };
}
