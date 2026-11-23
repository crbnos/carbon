// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs
} from "react-router";
import {
  COST_OBJECTIVE_REQUIRED,
  projectValidator
} from "~/modules/projects/projects.models";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-details");

/**
 * The project's fields are the properties column of its Overview; this route
 * keeps only the action that saves them. An old link to Details lands on the
 * Overview.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "projects" });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  throw redirect(path.to.project(projectId));
}

/** A field the properties column saves on its own (`intent=field`). */
const PROJECT_PROPERTY_FIELDS = new Set([
  "name",
  "description",
  "customerId",
  "ownerId",
  "locationId",
  "priority",
  "startDate",
  "endDate",
  "costTreatment",
  "costAccountId",
  "fixedAssetClassId",
  "costObjective",
  "projectStock",
  "chargeAtReceipt",
  "governmentFurnished",
  "planningGroupId",
  "planningPriority",
  "restrictCharging",
  "lockPlanAfterMilestoneId"
]);
const CHECKBOX_FIELDS = new Set([
  "projectStock",
  "chargeAtReceipt",
  "governmentFurnished",
  "restrictCharging"
]);

/**
 * The project as the form would post it, with one field changed: the
 * properties column saves one field, and every rule below still sees the
 * whole project.
 */
function withOneField(
  project: Record<string, unknown>,
  field: string,
  value: string
) {
  const formData = new FormData();
  for (const name of PROJECT_PROPERTY_FIELDS) {
    const raw = name === field ? value : project[name];
    if (CHECKBOX_FIELDS.has(name)) {
      if (raw === true || raw === "true" || raw === "on") {
        formData.set(name, "on");
      }
    } else if (raw !== null && raw !== undefined && raw !== "") {
      formData.set(name, String(raw));
    }
  }
  formData.set("id", String(project.id));
  if (project.identifier)
    formData.set("identifier", String(project.identifier));
  return formData;
}

/** The refusals of `updateProject` that belong to one field of the form. */
const FIELD_REFUSALS: Record<string, string> = {
  [COST_OBJECTIVE_REQUIRED]: "costObjective",
  "Choose a milestone of this project": "lockPlanAfterMilestoneId",
  "Only a project with project stock can join a group": "planningGroupId",
  "Choose a planning group": "planningGroupId",
  "The group must be at the project's location": "planningGroupId"
};

export const middleware = [redirectBeforeLoaders(loader)];

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const api = await carbon(request);

  // `intent=field` saves one field of the properties column; the Settings
  // form posted every field.
  const posted = await request.formData();
  const isField = posted.get("intent") === "field";

  let formData = posted;
  if (isField) {
    const field = String(posted.get("field") ?? "");
    if (!PROJECT_PROPERTY_FIELDS.has(field)) {
      return data({ error: { message: "Invalid field" } }, { status: 400 });
    }
    const project = await api.projects.getProject({ projectId });
    if (project.error || !project.data) {
      logger.error("Failed to load the project", {
        projectId,
        error: project.error
      });
      return data(
        { error: { message: "Failed to load the project" } },
        { status: 400 }
      );
    }
    formData = withOneField(
      project.data as Record<string, unknown>,
      field,
      String(posted.get("value") ?? "")
    );
  }

  const validation = await validator(projectValidator).validate(formData);
  if (validation.error) {
    if (isField) {
      const message =
        Object.values(validation.error.fieldErrors ?? {})[0] ??
        "Failed to save the change";
      return data({ error: { message } }, { status: 400 });
    }
    return validationError(validation.error);
  }

  const result = await api.projects.updateProject({
    ...validation.data,
    id: projectId
  });

  if (result.error) {
    if (isField) {
      return data(
        { error: { message: result.error.message } },
        { status: 400 }
      );
    }
    const field = FIELD_REFUSALS[result.error.message];
    if (field) {
      return validationError({
        fieldErrors: { [field]: result.error.message }
      });
    }
    return data({}, await flash(request, error(null, result.error.message)));
  }

  // The project is saved; its assets under construction were not created.
  if (result.data.warning) {
    if (isField) {
      return data({ error: { message: result.data.warning } }, { status: 400 });
    }
    throw redirect(
      path.to.project(projectId),
      await flash(request, error(null, result.data.warning))
    );
  }

  if (isField) return data({ success: true, error: null });
  throw redirect(
    path.to.project(projectId),
    await flash(request, success("Project updated"))
  );
}
