// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { projectControlSettingsValidator } from "@carbon/ee/project-control";
import { updateProjectControlSettings } from "@carbon/ee/project-control.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Project, ProjectLabel, ProjectState } from "~/modules/projects";
import {
  addProjectMember,
  deleteProjectLabel,
  deleteProjectState,
  getProjectMembers,
  projectLabelValidator,
  projectMemberValidator,
  projectStateValidator,
  removeProjectMember,
  setProjectStateDefault,
  upsertProjectLabel,
  upsertProjectState
} from "~/modules/projects";
import ProjectControlSettings from "~/modules/projects/ui/Project/ProjectControlSettings.ee";
import ProjectLabels from "~/modules/projects/ui/Project/ProjectLabels";
import ProjectMembers from "~/modules/projects/ui/Project/ProjectMembers";
import ProjectStates from "~/modules/projects/ui/Project/ProjectStates";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-settings");

const intents = [
  "upsertState",
  "deleteState",
  "setDefaultState",
  "upsertLabel",
  "deleteLabel",
  "addMember",
  "removeMember",
  "control-settings"
] as const;
type Intent = (typeof intents)[number];

/** The project's members: who may charge time when charging is restricted. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const members = await getProjectMembers(client, projectId, companyId);
  if (members.error) {
    logger.error("Failed to load the project members", {
      companyId,
      projectId,
      error: members.error
    });
  }
  return { members: members.data ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const intent = formData.get("intent") as Intent | null;
  const id = formData.get("id");

  const refuse = async (err: unknown, message: string) =>
    data({ success: false }, await flash(request, error(err, message)));
  const done = async (message: string) =>
    data({ success: true }, await flash(request, success(message)));

  switch (intent) {
    case "upsertState": {
      const validation = await validator(projectStateValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const { id: stateId, ...state } = validation.data;
      const result = stateId
        ? await upsertProjectState(client, {
            ...state,
            id: stateId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectState(client, {
            ...state,
            projectId,
            companyId,
            createdBy: userId
          });
      if (result.error) {
        return refuse(result.error, "Failed to save the state");
      }
      return done("State saved");
    }
    case "deleteState": {
      if (typeof id !== "string") return refuse(null, "No state was given");
      const result = await deleteProjectState(getDatabaseClient(), {
        companyId,
        projectId,
        id
      });
      if (result.error) {
        return refuse(result.error, result.error.message);
      }
      return done("State deleted");
    }
    case "setDefaultState": {
      if (typeof id !== "string") return refuse(null, "No state was given");
      const result = await setProjectStateDefault(getDatabaseClient(), {
        companyId,
        projectId,
        id,
        updatedBy: userId
      });
      if (result.error) {
        return refuse(result.error, result.error.message);
      }
      return done("Default state changed");
    }
    case "upsertLabel": {
      const validation = await validator(projectLabelValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const { id: labelId, ...label } = validation.data;
      const result = labelId
        ? await upsertProjectLabel(client, {
            ...label,
            id: labelId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectLabel(client, {
            ...label,
            projectId,
            companyId,
            createdBy: userId
          });
      if (result.error) {
        return refuse(result.error, "Failed to save the label");
      }
      return done("Label saved");
    }
    case "deleteLabel": {
      if (typeof id !== "string") return refuse(null, "No label was given");
      const result = await deleteProjectLabel(client, id, companyId);
      if (result.error) {
        return refuse(result.error, "Failed to delete the label");
      }
      return done("Label deleted");
    }
    case "addMember":
    case "removeMember": {
      const validation = await validator(projectMemberValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      if (validation.data.projectId !== projectId) {
        return refuse(null, "The member is not for this project");
      }
      if (intent === "removeMember") {
        const result = await removeProjectMember(client, {
          projectId,
          userId: validation.data.userId,
          companyId
        });
        if (result.error) {
          return refuse(result.error, "Failed to remove the member");
        }
        return done("Member removed");
      }
      // A member must be an employee of this company.
      const employee = await client
        .from("employee")
        .select("id")
        .eq("id", validation.data.userId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (employee.error || !employee.data) {
        return validationError({
          fieldErrors: { userId: "Choose an employee of this company" }
        });
      }
      const result = await addProjectMember(client, {
        projectId,
        userId: validation.data.userId,
        companyId,
        createdBy: userId
      });
      if (result.error) {
        return refuse(result.error, "Failed to add the member");
      }
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
        redirectTo: path.to.projectSettings(projectId)
      });
      formData.set("projectId", projectId);
      const validation = await validator(
        projectControlSettingsValidator
      ).validate(formData);
      if (validation.error) return validationError(validation.error);
      try {
        const result = await updateProjectControlSettings(client, {
          ...validation.data,
          companyId,
          userId
        });
        if (result.error) {
          logger.error("Failed to save the project control settings", {
            companyId,
            projectId,
            error: result.error
          });
          return refuse(result.error, "Failed to save the control settings");
        }
      } catch (err) {
        if (!(err instanceof EntitlementError)) throw err;
        logger.error("Project control is not in the company's plan", {
          companyId,
          projectId
        });
        return refuse(err, err.message);
      }
      return done("Control settings saved");
    }
    default:
      return refuse(null, "Unknown action");
  }
}

export default function ProjectSettingsRoute() {
  const { members } = useLoaderData<typeof loader>();
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const routeData = useRouteData<{
    project: Project;
    states: ProjectState[];
    labels: ProjectLabel[];
  }>(path.to.project(projectId));
  if (!routeData?.project) return null;

  const action = path.to.projectSettings(projectId);
  const isDisabled = routeData.project.status === "Closed";

  return (
    <VStack spacing={4} className="p-4 max-w-[60rem] mx-auto">
      <ProjectStates
        states={routeData.states}
        action={action}
        isDisabled={isDisabled}
      />
      <ProjectLabels
        labels={routeData.labels}
        action={action}
        isDisabled={isDisabled}
      />
      <ProjectControlSettings
        project={routeData.project}
        action={action}
        isDisabled={isDisabled}
      />
      {routeData.project.restrictCharging && (
        <ProjectMembers
          projectId={projectId}
          members={members}
          action={action}
          isDisabled={isDisabled}
        />
      )}
    </VStack>
  );
}
