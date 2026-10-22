// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import { projectElementCommentValidator } from "~/modules/projects/projects.models";

/**
 * The service twin of the project's element comments: `insert` adds a
 * comment (`addServiceWorkComment`); `delete` removes one of the user's own
 * (`deleteServiceWorkComment`).
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["elementId"] });
  if ("invalid" in input) return input.invalid;
  const formData = await args.request.formData();
  const api = await carbon(args.request);

  if (formData.get("intent") === "delete") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id) {
      return data(
        { success: false },
        await flash(args.request, error(null, "No comment was given"))
      );
    }
    const result = await api.service.deleteServiceWorkComment({ id });
    if (result.error) {
      return data(
        { success: false },
        await flash(args.request, error(null, result.error.message))
      );
    }
    return data(
      { success: true },
      await flash(args.request, success("Comment deleted"))
    );
  }

  formData.set("projectElementId", input.params.elementId);
  const validation = await validator(projectElementCommentValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const result = await api.service.addServiceWorkComment(validation.data);
  if (result.error) {
    return data(
      { success: false },
      await flash(args.request, error(null, result.error.message))
    );
  }
  return data({ success: true });
}
