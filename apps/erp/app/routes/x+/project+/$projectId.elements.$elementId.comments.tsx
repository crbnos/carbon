// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectElementCommentValidator } from "~/modules/projects/projects.models";

/** `insert` adds a comment; `delete` removes one of the user's own. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { elementId } = params;
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  const intent = formData.get("intent");
  const api = await carbon(request);

  if (intent === "delete") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id) {
      return data(
        { success: false },
        await flash(request, error(null, "No comment was given"))
      );
    }
    const result = await api.projects.deleteProjectElementComment({ id });
    if (result.error) {
      return data(
        { success: false },
        await flash(request, error(null, result.error.message))
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

  const result = await api.projects.insertProjectElementComment(
    validation.data
  );
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(null, result.error.message))
    );
  }
  return data({ success: true });
}
