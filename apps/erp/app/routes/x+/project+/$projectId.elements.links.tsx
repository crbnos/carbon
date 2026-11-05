// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { projectElementLinkValidator } from "~/modules/projects/projects.models";
import { readChangeRequestId } from "~/modules/projects/projects.service";

/**
 * Trace links of a project's elements. `intent` picks the change: `upsert`
 * adds a link, `delete` removes one, `clearSuspect` marks one reviewed and
 * `saveFormula` saves a Parameter's formula with its `feeds` links. While a
 * change request is open, adding or deleting a link goes into it; reviewing
 * a suspect link is progress and stays live.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id");
  const changeRequestId = readChangeRequestId(request, formData);
  const api = await carbon(request);
  const respond = (result: { error: { message: string } | null }) =>
    result.error
      ? { error: { message: result.error.message } }
      : { success: true };

  switch (intent) {
    case "upsert": {
      const validation = await validator(projectElementLinkValidator).validate(
        formData
      );
      if (validation.error) {
        return { error: { message: "Choose an element and a link type" } };
      }
      return respond(
        await api.projects.upsertProjectElementLink({
          ...validation.data,
          projectId,
          changeRequestId
        })
      );
    }
    case "delete":
    case "clearSuspect": {
      if (typeof id !== "string" || !id) {
        return { error: { message: "No link selected" } };
      }
      return respond(
        intent === "delete"
          ? await api.projects.deleteProjectElementLink({
              projectId,
              id,
              changeRequestId
            })
          : await api.projects.clearSuspectLink({ projectId, id })
      );
    }
    case "saveFormula": {
      const elementId = formData.get("elementId");
      const formula = formData.get("formula");
      if (typeof elementId !== "string" || typeof formula !== "string") {
        return { error: { message: "Enter a formula" } };
      }
      return respond(
        await api.projects.saveParameterFormula({
          projectId,
          elementId,
          formula,
          changeRequestId
        })
      );
    }
    default:
      return { error: { message: "Unknown action" } };
  }
}
