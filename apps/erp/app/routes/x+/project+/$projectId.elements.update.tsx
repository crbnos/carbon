// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { projectElementFieldUpdateValidator } from "~/modules/projects/projects.models";
import { readChangeRequestId } from "~/modules/projects/projects.service";

/**
 * Saves one field on one or more elements: the pills of the List and Board
 * layouts, the cells of the Table layout and the element sidebar post here.
 * `labelIds` replaces the labels of one element (a comma-separated list);
 * `isBilling` writes live through its own update. A plan-layer field goes
 * into the open change request.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const field = formData.get("field");
  const api = await carbon(request);
  const respond = (result: { error: { message: string } | null }) =>
    result.error
      ? { error: { message: result.error.message } }
      : { success: true };

  if (field === "labelIds") {
    const ids = formData.getAll("ids").filter((id) => typeof id === "string");
    if (ids.length !== 1) {
      return {
        error: { message: "Change the labels of one element at a time" }
      };
    }
    const value = formData.get("value");
    const labelIds =
      typeof value === "string" && value.length > 0 ? value.split(",") : [];
    return respond(
      await api.projects.setProjectElementLabels({
        projectId,
        projectElementId: ids[0] as string,
        labelIds
      })
    );
  }

  // The billing flag is not a plan-layer field and has its own rules (one
  // billing element per branch), so it writes live through its own update.
  if (field === "isBilling") {
    const ids = formData.getAll("ids").filter((id) => typeof id === "string");
    if (ids.length === 0) {
      return { error: { message: "Choose an element" } };
    }
    const value = formData.get("value");
    return respond(
      await api.projects.updateProjectElementBilling({
        projectId,
        ids: ids as string[],
        isBilling: value === "true" || value === "on"
      })
    );
  }

  const validation = await validator(
    projectElementFieldUpdateValidator
  ).validate(formData);
  if (validation.error) {
    return { error: { message: "Invalid form data" } };
  }

  return respond(
    await api.projects.updateProjectElementField({
      ...validation.data,
      projectId,
      changeRequestId: readChangeRequestId(request, formData)
    })
  );
}
