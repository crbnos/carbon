// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteProjectStockTransferLine,
  projectStockTransferLineValidator,
  upsertProjectStockTransferLine
} from "~/modules/projects";

/**
 * Adds, changes (`intent=save`) or deletes (`intent=delete`) a line of a
 * Draft project stock transfer.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();

  if (formData.get("intent") === "delete") {
    const lineId = formData.get("id");
    if (typeof lineId !== "string" || !lineId) {
      return data(
        { success: false },
        await flash(request, error(null, "Line not found"))
      );
    }
    const deleted = await deleteProjectStockTransferLine(client, {
      id: lineId,
      projectStockTransferId: id,
      companyId
    });
    if (deleted.error) {
      return data(
        { success: false },
        await flash(request, error(deleted.error, "Failed to delete the line"))
      );
    }
    return data(
      { success: true },
      await flash(request, success("Line deleted"))
    );
  }

  const validation = await validator(
    projectStockTransferLineValidator
  ).validate(formData);
  if (validation.error) return validationError(validation.error);

  const saved = await upsertProjectStockTransferLine(client, {
    ...validation.data,
    projectStockTransferId: id,
    companyId,
    userId
  });
  if (saved.error) {
    return data(
      { success: false },
      await flash(request, error(saved.error, "Failed to save the line"))
    );
  }

  return data({ success: true }, await flash(request, success("Line saved")));
}
