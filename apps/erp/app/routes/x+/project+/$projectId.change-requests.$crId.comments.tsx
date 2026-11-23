// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectChangeRequestCommentValidator } from "~/modules/projects/projects.models";

/**
 * Comments of a change request. `intent` picks the change: `create` adds one
 * (on the change request, an element or one changed field), `resolve` marks
 * one resolved, `delete` removes the user's own comment.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId, crId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!crId) throw new Error("Could not find crId");

  const refuse = async (message: string) =>
    data({ success: false }, await flash(request, error(null, message)));

  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id");
  const scope = { projectId, changeRequestId: crId };

  if (intent === "create") {
    const validation = await validator(
      projectChangeRequestCommentValidator
    ).validate(formData);
    if (validation.error) return validationError(validation.error);
    const api = await carbon(request);
    const result = await api.projects.createProjectChangeRequestComment({
      ...validation.data,
      ...scope
    });
    if (result.error) return refuse(result.error.message);
    return data({ success: true });
  }

  if (intent !== "resolve" && intent !== "delete") {
    return refuse("Unknown action");
  }
  if (typeof id !== "string" || !id) return refuse("No comment");

  const api = await carbon(request);
  const result =
    intent === "resolve"
      ? await api.projects.resolveProjectChangeRequestComment({ ...scope, id })
      : await api.projects.deleteProjectChangeRequestComment({ ...scope, id });
  if (result.error) return refuse(result.error.message);
  return data({ success: true });
}
