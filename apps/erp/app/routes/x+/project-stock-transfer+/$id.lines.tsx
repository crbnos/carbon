// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectStockTransferLineValidator } from "~/modules/projects/projects.models";

/**
 * Adds, changes (`intent=save`) or deletes (`intent=delete`) a line of a
 * Draft project stock transfer.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

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
    const api = await carbon(request);
    const deleted = await api.projects.deleteProjectStockTransferLine({
      id: lineId,
      projectStockTransferId: id
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

  const api = await carbon(request);
  const saved = await api.projects.upsertProjectStockTransferLine({
    ...validation.data,
    projectStockTransferId: id
  });
  if (saved.error) {
    return data(
      { success: false },
      await flash(request, error(saved.error, "Failed to save the line"))
    );
  }

  return data({ success: true }, await flash(request, success("Line saved")));
}
