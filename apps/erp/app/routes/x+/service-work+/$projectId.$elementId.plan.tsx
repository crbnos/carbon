// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import {
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator
} from "~/modules/projects/projects.models";
import type { ServicePlanTable } from "~/modules/service/service.models";

const DELETE_TABLES: Record<string, ServicePlanTable> = {
  deleteMaterial: "projectElementMaterial",
  deleteLabor: "projectElementLabor",
  deleteCost: "projectElementCost"
};

/**
 * Adds, edits and deletes the plan lines of an element of a service order's
 * or a service template's work: the service twin of the project's
 * `elements.$elementId.plan` (`upsertServiceWorkMaterial`,
 * `upsertServiceWorkLabor`, `upsertServiceWorkCost`,
 * `deleteServiceWorkPlanLine`). A grid cell posts `quiet` and gets
 * `{ error }` back instead of a flash.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["projectId", "elementId"]
  });
  if ("invalid" in input) return input.invalid;
  const { projectId, elementId } = input.params;

  const formData = await args.request.formData();
  const quiet = formData.get("quiet") === "true";
  const refuse = async (message: string) =>
    quiet
      ? data({ success: false, error: message }, { status: 400 })
      : data(
          { success: false },
          await flash(args.request, error(null, message))
        );
  // `id` is the line saved: a grid draft keeps it, so its next edit updates.
  const done = async (message: string, id?: string | null) =>
    quiet
      ? data({ success: true, error: null, id: id ?? null })
      : data({ success: true }, await flash(args.request, success(message)));
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

  formData.set("projectElementId", elementId);
  const intent = formData.get("intent");
  const api = await carbon(args.request);

  switch (intent) {
    case "upsertMaterial": {
      const validation = await validator(
        projectElementMaterialValidator
      ).validate(formData);
      if (validation.error) return invalid(validation);
      const result = await api.service.upsertServiceWorkMaterial({
        ...validation.data,
        projectId
      });
      if (result.error) return refuse(result.error.message);
      return done("Part saved", result.data.id);
    }
    case "upsertLabor": {
      const validation = await validator(projectElementLaborValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      const result = await api.service.upsertServiceWorkLabor({
        ...validation.data,
        projectId
      });
      if (result.error) return refuse(result.error.message);
      return done("Labor saved", result.data.id);
    }
    case "upsertCost": {
      const validation = await validator(projectElementCostValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      const result = await api.service.upsertServiceWorkCost({
        ...validation.data,
        projectId
      });
      if (result.error) return refuse(result.error.message);
      return done("Cost saved", result.data.id);
    }
    case "deleteMaterial":
    case "deleteLabor":
    case "deleteCost": {
      const lineId = formData.get("id");
      if (typeof lineId !== "string" || !lineId) {
        return refuse("No line was given");
      }
      const result = await api.service.deleteServiceWorkPlanLine({
        projectId,
        projectElementId: elementId,
        table: DELETE_TABLES[intent]!,
        lineId
      });
      if (result.error) return refuse(result.error.message);
      return done("Line deleted");
    }
    default:
      return refuse("Unknown action");
  }
}
