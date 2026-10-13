// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectChangeRequestCommentValidator } from "~/modules/projects";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-change-request-comments");

/**
 * Comments of a change request. `intent` picks the change: `create` adds one
 * (on the change request, an element or one changed field), `resolve` marks
 * one resolved, `delete` removes the user's own comment.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId, crId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!crId) throw new Error("Could not find crId");

  const refuse = async (err: unknown, message: string) => {
    logger.error(message, { companyId, changeRequestId: crId, error: err });
    return data({ success: false }, await flash(request, error(err, message)));
  };

  // The change request must be one of this project.
  const changeRequest = await client
    .from("projectChangeRequest")
    .select("id")
    .eq("id", crId)
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (changeRequest.error || !changeRequest.data) {
    return refuse(changeRequest.error, "The change request does not exist");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id");

  switch (intent) {
    case "create": {
      const validation = await validator(
        projectChangeRequestCommentValidator
      ).validate(formData);
      if (validation.error) return validationError(validation.error);
      const { comment, targetTable, targetId, field } = validation.data;
      const inserted = await client.from("projectChangeRequestComment").insert({
        changeRequestId: crId,
        companyId,
        comment,
        targetTable: targetTable ?? null,
        targetId: targetTable ? (targetId ?? null) : null,
        field: targetTable && targetId ? (field ?? null) : null,
        createdBy: userId
      });
      if (inserted.error) return refuse(inserted.error, "Failed to comment");
      return data({ success: true });
    }
    case "resolve": {
      if (typeof id !== "string" || !id) return refuse(null, "No comment");
      // Any reviewer who may change the project resolves a comment; RLS lets
      // only the author update the row, so this write runs over Kysely.
      await requirePermissions(request, { update: "projects" });
      const resolved = await getDatabaseClient()
        .updateTable("projectChangeRequestComment")
        .set({
          resolvedAt: datetime.timestamp(),
          resolvedBy: userId,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", id)
        .where("changeRequestId", "=", crId)
        .where("companyId", "=", companyId)
        .returning("id")
        .executeTakeFirst();
      if (!resolved) return refuse(null, "Failed to resolve the comment");
      return data({ success: true });
    }
    case "delete": {
      if (typeof id !== "string" || !id) return refuse(null, "No comment");
      const deleted = await client
        .from("projectChangeRequestComment")
        .delete()
        .eq("id", id)
        .eq("changeRequestId", crId)
        .eq("companyId", companyId)
        .eq("createdBy", userId);
      if (deleted.error) return refuse(deleted.error, "Failed to delete");
      return data({ success: true });
    }
    default:
      return refuse(null, "Unknown action");
  }
}
