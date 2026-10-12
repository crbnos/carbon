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
  getProject,
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator,
  upsertProjectElementCost,
  upsertProjectElementLabor,
  upsertProjectElementMaterial
} from "~/modules/projects";
import {
  deletePlanLineInChangeRequest,
  type PlanLineTable,
  readChangeRequestId,
  requireEditablePlanRoute,
  upsertPlanLineInChangeRequest
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-element-plan");

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
 * posts `quiet` and gets `{ error }` back instead of a flash.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  const quiet = formData.get("quiet") === "true";
  const refuse = async (err: unknown, message: string) =>
    quiet
      ? data({ success: false, error: message }, { status: 400 })
      : data({ success: false }, await flash(request, error(err, message)));
  const done = async (message: string) =>
    quiet
      ? data({ success: true, error: null })
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

  const project = await getProject(client, companyId, projectId);
  if (project.error || !project.data) {
    logger.error("Failed to load project", {
      companyId,
      projectId,
      error: project.error
    });
    return refuse(project.error, "Failed to load the project");
  }
  if (project.data.status === "Closed") {
    return refuse(null, "A Closed project cannot change");
  }

  const intent = formData.get("intent") as Intent | null;
  formData.set("projectElementId", elementId);
  const id = formData.get("id");

  // While a change request is open, plan lines change in it instead.
  const changeRequestId = readChangeRequestId(request, formData);
  // A locked plan takes plan-layer changes only through a change request.
  const locked = await requireEditablePlanRoute(request, {
    client,
    projectId,
    companyId,
    changeRequestId,
    withFlash: !quiet
  });
  if (locked) return locked;
  const inChangeRequest = async (
    table: PlanLineTable,
    line: { id?: string; projectElementId: string } & Record<string, unknown>,
    message: string
  ) => {
    if (!changeRequestId) return null;
    const { id: lineId, projectElementId: _element, ...fields } = line;
    try {
      await upsertPlanLineInChangeRequest(getDatabaseClient(), {
        companyId,
        userId,
        projectId,
        changeRequestId,
        table,
        id: lineId,
        elementId,
        fields
      });
    } catch (err) {
      return failed(err, err instanceof Error ? err.message : message);
    }
    return done(message);
  };

  const failed = (err: unknown, message: string) => {
    logger.error(message, {
      companyId,
      projectId,
      elementId,
      intent,
      error: err
    });
    return refuse(err, message);
  };

  switch (intent) {
    case "upsertMaterial": {
      const validation = await validator(
        projectElementMaterialValidator
      ).validate(formData);
      if (validation.error) return invalid(validation);
      const staged = await inChangeRequest(
        "projectElementMaterial",
        validation.data,
        "Material saved"
      );
      if (staged) return staged;
      const { id: lineId, ...line } = validation.data;
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
      if (result.error)
        return failed(result.error, "Failed to save the material");
      return done("Material saved");
    }
    case "upsertLabor": {
      const validation = await validator(projectElementLaborValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      const staged = await inChangeRequest(
        "projectElementLabor",
        validation.data,
        "Labor saved"
      );
      if (staged) return staged;
      const { id: lineId, ...line } = validation.data;
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
      if (result.error) return failed(result.error, "Failed to save the labor");
      return done("Labor saved");
    }
    case "upsertCost": {
      const validation = await validator(projectElementCostValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      const staged = await inChangeRequest(
        "projectElementCost",
        validation.data,
        "Cost saved"
      );
      if (staged) return staged;
      const { id: lineId, ...line } = validation.data;
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
      if (result.error) return failed(result.error, "Failed to save the cost");
      return done("Cost saved");
    }
    case "deleteMaterial":
    case "deleteLabor":
    case "deleteCost": {
      if (typeof id !== "string" || !id)
        return refuse(null, "No line was given");
      if (changeRequestId) {
        const table: PlanLineTable =
          intent === "deleteMaterial"
            ? "projectElementMaterial"
            : intent === "deleteLabor"
              ? "projectElementLabor"
              : "projectElementCost";
        try {
          await deletePlanLineInChangeRequest(getDatabaseClient(), {
            companyId,
            userId,
            projectId,
            changeRequestId,
            table,
            id
          });
        } catch (err) {
          return failed(
            err,
            err instanceof Error ? err.message : "Failed to delete the line"
          );
        }
        return done("Line deleted");
      }
      const remove =
        intent === "deleteMaterial"
          ? deleteProjectElementMaterial
          : intent === "deleteLabor"
            ? deleteProjectElementLabor
            : deleteProjectElementCost;
      const result = await remove(client, id, companyId);
      if (result.error)
        return failed(result.error, "Failed to delete the line");
      return done("Line deleted");
    }
    default:
      return refuse(null, "Unknown action");
  }
}
