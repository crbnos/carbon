// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { projectElementFieldUpdateValidator } from "~/modules/projects/projects.models";

/**
 * Saves one field on one or more elements of a service order's or a service
 * template's work (`updateServiceWorkElements`): the service twin of the
 * project's `elements.update`. The list's pills and the element page post
 * here. `labelIds` replaces the labels of one element
 * (`setServiceWorkElementLabels`).
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["projectId"] });
  if ("invalid" in input) return input.invalid;
  const { projectId } = input.params;
  const formData = await args.request.formData();
  const api = await carbon(args.request);

  if (formData.get("field") === "labelIds") {
    const ids = formData
      .getAll("ids")
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length !== 1) {
      return {
        error: { message: "Change the labels of one element at a time" }
      };
    }
    const value = formData.get("value");
    const result = await api.service.setServiceWorkElementLabels({
      projectId,
      projectElementId: ids[0]!,
      labelIds:
        typeof value === "string" && value.length > 0 ? value.split(",") : []
    });
    if (result.error) return { error: { message: result.error.message } };
    return { success: true };
  }

  const validation = await validator(
    projectElementFieldUpdateValidator
  ).validate(formData);
  if (validation.error) return { error: { message: "Invalid form data" } };

  const result = await api.service.updateServiceWorkElements({
    ...validation.data,
    projectId
  });
  if (result.error) return { error: { message: result.error.message } };
  return { success: true };
}
