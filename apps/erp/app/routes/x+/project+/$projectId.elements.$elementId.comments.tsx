// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectElementCommentValidator } from "~/modules/projects/projects.models";
import {
  deleteProjectElementComment,
  insertProjectElementComment
} from "~/modules/projects/projects.service";

const logger = getLogger("erp", "project-element-comments");

/** `insert` adds a comment; `delete` removes one of the user's own. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });

  const { elementId } = params;
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id) {
      return data(
        { success: false },
        await flash(request, error(null, "No comment was given"))
      );
    }
    const result = await deleteProjectElementComment(
      client,
      id,
      companyId,
      userId
    );
    if (result.error) {
      logger.error("Failed to delete comment", {
        companyId,
        elementId,
        error: result.error
      });
      return data(
        { success: false },
        await flash(
          request,
          error(result.error, result.error.message ?? "Failed to delete")
        )
      );
    }
    return data(
      { success: true },
      await flash(request, success("Comment deleted"))
    );
  }

  formData.set("projectElementId", elementId);
  const validation = await validator(projectElementCommentValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const result = await insertProjectElementComment(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });
  if (result.error) {
    logger.error("Failed to add comment", {
      companyId,
      elementId,
      error: result.error
    });
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to add the comment"))
    );
  }
  return data({ success: true });
}
