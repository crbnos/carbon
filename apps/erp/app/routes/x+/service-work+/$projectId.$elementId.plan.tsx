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
import {
  deleteProjectElementCost,
  deleteProjectElementLabor,
  deleteProjectElementMaterial,
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator,
  upsertProjectElementCost,
  upsertProjectElementLabor,
  upsertProjectElementMaterial
} from "~/modules/projects";
import {
  requireServiceWork,
  ServiceOrderError
} from "~/modules/service/service.server";

const logger = getLogger("erp", "service-work-plan");

type PlanTable =
  | "projectElementMaterial"
  | "projectElementLabor"
  | "projectElementCost";

/**
 * Adds, edits and deletes the plan lines of an element of a service order's
 * or a service template's work: the service twin of the project's
 * `elements.$elementId.plan`. A grid cell posts `quiet` and gets
 * `{ error }` back instead of a flash.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  const quiet = formData.get("quiet") === "true";
  const refuse = async (err: unknown, message: string) => {
    if (err && !(err instanceof ServiceOrderError)) {
      logger.error(message, { companyId, projectId, elementId, error: err });
    }
    return quiet
      ? data({ success: false, error: message }, { status: 400 })
      : data({ success: false }, await flash(request, error(err, message)));
  };
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

  try {
    await requireServiceWork(client, {
      companyId,
      projectId,
      elementIds: [elementId]
    });
  } catch (err) {
    return refuse(
      err,
      err instanceof Error ? err.message : "Failed to save the line"
    );
  }

  formData.set("projectElementId", elementId);
  const intent = formData.get("intent");

  /** That an edited or deleted line belongs to this element. */
  const ownsLine = async (table: PlanTable, lineId: string) => {
    const line = await client
      .from(table)
      .select("id")
      .eq("id", lineId)
      .eq("projectElementId", elementId)
      .eq("companyId", companyId)
      .maybeSingle();
    return Boolean(line.data);
  };

  switch (intent) {
    case "upsertMaterial": {
      const validation = await validator(
        projectElementMaterialValidator
      ).validate(formData);
      if (validation.error) return invalid(validation);
      const { id: lineId, ...line } = validation.data;
      if (lineId && !(await ownsLine("projectElementMaterial", lineId))) {
        return refuse(null, "The line is not on this element");
      }
      const result = lineId
        ? await upsertProjectElementMaterial(client, {
            ...line,
            id: lineId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectElementMaterial(client, {
            ...line,
            projectId,
            companyId,
            createdBy: userId
          });
      if (result.error) return refuse(result.error, "Failed to save the part");
      return done("Part saved", result.data?.id);
    }
    case "upsertLabor": {
      const validation = await validator(projectElementLaborValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      const { id: lineId, ...line } = validation.data;
      if (lineId && !(await ownsLine("projectElementLabor", lineId))) {
        return refuse(null, "The line is not on this element");
      }
      const result = lineId
        ? await upsertProjectElementLabor(client, {
            ...line,
            id: lineId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectElementLabor(client, {
            ...line,
            projectId,
            companyId,
            createdBy: userId
          });
      if (result.error) return refuse(result.error, "Failed to save the labor");
      return done("Labor saved", result.data?.id);
    }
    case "upsertCost": {
      const validation = await validator(projectElementCostValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      const { id: lineId, ...line } = validation.data;
      if (lineId && !(await ownsLine("projectElementCost", lineId))) {
        return refuse(null, "The line is not on this element");
      }
      const result = lineId
        ? await upsertProjectElementCost(client, {
            ...line,
            id: lineId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectElementCost(client, {
            ...line,
            projectId,
            companyId,
            createdBy: userId
          });
      if (result.error) return refuse(result.error, "Failed to save the cost");
      return done("Cost saved", result.data?.id);
    }
    case "deleteMaterial":
    case "deleteLabor":
    case "deleteCost": {
      const lineId = formData.get("id");
      if (typeof lineId !== "string" || !lineId) {
        return refuse(null, "No line was given");
      }
      const table: PlanTable =
        intent === "deleteMaterial"
          ? "projectElementMaterial"
          : intent === "deleteLabor"
            ? "projectElementLabor"
            : "projectElementCost";
      if (!(await ownsLine(table, lineId))) {
        return refuse(null, "The line is not on this element");
      }
      const remove =
        intent === "deleteMaterial"
          ? deleteProjectElementMaterial
          : intent === "deleteLabor"
            ? deleteProjectElementLabor
            : deleteProjectElementCost;
      const result = await remove(client, lineId, companyId);
      if (result.error)
        return refuse(result.error, "Failed to delete the line");
      return done("Line deleted");
    }
    default:
      return refuse(null, "Unknown action");
  }
}
