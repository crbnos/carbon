// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import {
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator
} from "~/modules/projects/projects.models";
import { readChangeRequestId } from "~/modules/projects/projects.service";

const intents = [
  "upsertMaterial",
  "deleteMaterial",
  "upsertLabor",
  "deleteLabor",
  "upsertCost",
  "deleteCost"
] as const;
type Intent = (typeof intents)[number];

/**
 * Creates, updates and deletes the plan lines of an element. A grid cell
 * posts `quiet` and gets `{ error }` back instead of a flash. While a change
 * request is open, the lines change in it instead (`changeRequestId`, or
 * `?cr=`); the operation refuses a Closed project and a locked plan.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  const quiet = formData.get("quiet") === "true";
  const refuse = async (message: string) =>
    quiet
      ? data({ success: false, error: message }, { status: 400 })
      : data({ success: false }, await flash(request, error(null, message)));
  // `id` is the line saved: a grid draft keeps it, so its next edit updates.
  const done = async (message: string, id?: string) =>
    quiet
      ? data({ success: true, error: null, id: id ?? null })
      : data({ success: true }, await flash(request, success(message)));
  const invalid = (validation: {
    error: Parameters<typeof validationError>[0];
  }) =>
    quiet
      ? data(
          {
            success: false,
            error:
              Object.values(validation.error.fieldErrors ?? {})[0] ??
              "Invalid line"
          },
          { status: 400 }
        )
      : validationError(validation.error);
  const settle = (
    result: {
      data: { id: string } | null;
      error: { message: string } | null;
    },
    message: string
  ) =>
    result.error
      ? refuse(result.error.message)
      : done(message, result.data?.id);

  const intent = formData.get("intent") as Intent | null;
  formData.set("projectElementId", elementId);
  const id = formData.get("id");
  const scope = {
    projectId,
    changeRequestId: readChangeRequestId(request, formData)
  };

  const api = await carbon(request);

  switch (intent) {
    case "upsertMaterial": {
      const validation = await validator(
        projectElementMaterialValidator
      ).validate(formData);
      if (validation.error) return invalid(validation);
      return settle(
        await api.projects.upsertProjectElementMaterial({
          ...validation.data,
          ...scope
        }),
        "Material saved"
      );
    }
    case "upsertLabor": {
      const validation = await validator(projectElementLaborValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      return settle(
        await api.projects.upsertProjectElementLabor({
          ...validation.data,
          ...scope
        }),
        "Labor saved"
      );
    }
    case "upsertCost": {
      const validation = await validator(projectElementCostValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      return settle(
        await api.projects.upsertProjectElementCost({
          ...validation.data,
          ...scope
        }),
        "Cost saved"
      );
    }
    case "deleteMaterial":
    case "deleteLabor":
    case "deleteCost": {
      if (typeof id !== "string" || !id) return refuse("No line was given");
      const remove =
        intent === "deleteMaterial"
          ? api.projects.deleteProjectElementMaterial
          : intent === "deleteLabor"
            ? api.projects.deleteProjectElementLabor
            : api.projects.deleteProjectElementCost;
      return settle(await remove({ id, ...scope }), "Line deleted");
    }
    default:
      return refuse("Unknown action");
  }
}
