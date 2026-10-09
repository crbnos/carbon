// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { data, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Project, ProjectLabel, ProjectState } from "~/modules/projects";
import {
  deleteProjectLabel,
  deleteProjectState,
  projectLabelValidator,
  projectStateValidator,
  setProjectStateDefault,
  upsertProjectLabel,
  upsertProjectState
} from "~/modules/projects";
import ProjectLabels from "~/modules/projects/ui/Project/ProjectLabels";
import ProjectStates from "~/modules/projects/ui/Project/ProjectStates";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const intents = [
  "upsertState",
  "deleteState",
  "setDefaultState",
  "upsertLabel",
  "deleteLabel"
] as const;
type Intent = (typeof intents)[number];

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
    default:
      return refuse(null, "Unknown action");
  }
}

export default function ProjectSettingsRoute() {
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
    </VStack>
  );
}
