// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { projectControlSettingsValidator } from "@carbon/ee/project-control";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectMemberValidator } from "~/modules/projects/projects.models";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-settings");

// States and labels are company-wide: Settings → Projects edits them.
const intents = ["addMember", "removeMember", "control-settings"] as const;
type Intent = (typeof intents)[number];

/** The project's members: who may charge time when charging is restricted. */
/**
 * The project's settings are the properties column of its Overview; this
 * route keeps the action that saves the members and the project control
 * settings. An old link to Settings lands on the Overview.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "projects" });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  throw redirect(path.to.project(projectId));
}

export const middleware = [redirectBeforeLoaders(loader)];

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const intent = formData.get("intent") as Intent | null;

  const refuse = async (message: string) =>
    data({ success: false }, await flash(request, error(null, message)));
  const done = async (message: string) =>
    data({ success: true }, await flash(request, success(message)));

  const api = await carbon(request);

  switch (intent) {
    case "addMember":
    case "removeMember": {
      const validation = await validator(projectMemberValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      if (validation.data.projectId !== projectId) {
        return refuse("The member is not for this project");
      }
      if (intent === "removeMember") {
        const result = await api.projects.removeProjectMember(validation.data);
        if (result.error) return refuse(result.error.message);
        return done("Member removed");
      }
      const result = await api.projects.addProjectMember(validation.data);
      if (result.error?.category === "validation") {
        return validationError({
          fieldErrors: { userId: result.error.message }
        });
      }
      if (result.error) return refuse(result.error.message);
      return done("Member added");
    }
    case "control-settings": {
      // Government Contracting 5c: commercial. `requireFeature` is the
      // upgrade redirect; `requireEntitlement` in the ee function is the lock.
      await requireFeature({
        request,
        client,
        companyId,
        feature: "GOVERNMENT_CONTRACTING",
        redirectTo: path.to.project(projectId)
      });
      formData.set("projectId", projectId);
      const validation = await validator(
        projectControlSettingsValidator
      ).validate(formData);
      if (validation.error) return validationError(validation.error);
      const result = await api.projects.updateProjectControlSettings(
        validation.data
      );
      if (result.error) {
        logger.error("Failed to save the project control settings", {
          companyId,
          projectId,
          error: result.error
        });
        return refuse(result.error.message);
      }
      return done("Control settings saved");
    }
    default:
      return refuse("Unknown action");
  }
}
