// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyTimeZone } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Project } from "~/modules/projects";
import {
  completeProjectMilestone,
  deleteProjectMilestone,
  getProjectCostSummary,
  getProjectElements,
  getProjectMilestones,
  projectMilestoneValidator,
  summarizeMilestones,
  upsertProjectMilestone
} from "~/modules/projects";
import MilestonesList from "~/modules/projects/ui/Milestones/MilestonesList";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-milestones");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const [milestones, elements, costSummary, timeZone] = await Promise.all([
    getProjectMilestones(client, projectId, companyId),
    getProjectElements(client, projectId, companyId),
    getProjectCostSummary(client, projectId, companyId),
    getCompanyTimeZone(client, companyId)
  ]);

  if (milestones.error) {
    logger.error("Failed to load milestones", {
      companyId,
      projectId,
      error: milestones.error
    });
  }
  if (elements.error) {
    logger.error("Failed to load project elements", {
      companyId,
      projectId,
      error: elements.error
    });
  }
  if (costSummary.error) {
    logger.error("Failed to load project cost summary", {
      companyId,
      projectId,
      error: costSummary.error
    });
  }

  return {
    milestones: summarizeMilestones({
      milestones: milestones.data ?? [],
      elements: elements.data ?? [],
      costSummary: costSummary.data ?? [],
      today: datetime.today(timeZone).toString()
    })
  };
}

const intents = ["upsert", "complete", "reopen", "delete"] as const;
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
    case "upsert": {
      const validation = await validator(projectMilestoneValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const { id: milestoneId, ...milestone } = validation.data;
      const result = milestoneId
        ? await upsertProjectMilestone(client, {
            ...milestone,
            id: milestoneId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectMilestone(client, {
            ...milestone,
            projectId,
            companyId,
            createdBy: userId
          });
      if (result.error) {
        return refuse(result.error, "Failed to save the milestone");
      }
      return done("Milestone saved");
    }
    case "complete":
    case "reopen": {
      if (typeof id !== "string") return refuse(null, "No milestone was given");
      const result = await completeProjectMilestone(client, {
        id,
        companyId,
        completed: intent === "complete",
        updatedBy: userId
      });
      if (result.error) {
        return refuse(result.error, "Failed to update the milestone");
      }
      return done(
        intent === "complete" ? "Milestone completed" : "Milestone reopened"
      );
    }
    case "delete": {
      if (typeof id !== "string") return refuse(null, "No milestone was given");
      const result = await deleteProjectMilestone(client, id, companyId);
      if (result.error) {
        return refuse(result.error, "Failed to delete the milestone");
      }
      return done("Milestone deleted");
    }
    default:
      return refuse(null, "Unknown action");
  }
}

export default function ProjectMilestonesRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const { milestones } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ project: Project }>(
    path.to.project(projectId)
  );
  if (!routeData?.project) return null;

  return (
    <MilestonesList
      projectId={projectId}
      milestones={milestones}
      action={path.to.projectMilestones(projectId)}
      isDisabled={routeData.project.status === "Closed"}
    />
  );
}
