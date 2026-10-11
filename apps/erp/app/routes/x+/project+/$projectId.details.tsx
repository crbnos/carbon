// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Project, ProjectMilestone } from "~/modules/projects";
import {
  COST_OBJECTIVE_REQUIRED,
  getProject,
  projectValidator,
  updateProject
} from "~/modules/projects";
import { ensureCapitalAssets } from "~/modules/projects/projects.server";
import { ProjectForm } from "~/modules/projects/ui/Projects";
import { getCompanySettings } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-details");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const validation = await validator(projectValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  // The identifier is fixed once the project exists: every element's stored
  // readable id starts with it.
  const { id: _id, identifier: _identifier, ...fields } = validation.data;

  // DCAA timekeeping: every project needs a cost objective.
  if (!fields.costObjective) {
    const settings = await getCompanySettings(client, companyId);
    if (settings.data?.timekeepingControls === "DCAA") {
      return validationError({
        fieldErrors: { costObjective: COST_OBJECTIVE_REQUIRED }
      });
    }
  }

  // The lock milestone must be one of this project's milestones.
  if (fields.lockPlanAfterMilestoneId) {
    const milestone = await client
      .from("projectMilestone")
      .select("id")
      .eq("id", fields.lockPlanAfterMilestoneId)
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (milestone.error || !milestone.data) {
      return validationError({
        fieldErrors: {
          lockPlanAfterMilestoneId: "Choose a milestone of this project"
        }
      });
    }
  }

  // Project stock is chosen while Draft only: after that the switch is
  // disabled, so its absent value never turns it off.
  const current = await getProject(client, companyId, projectId);
  if (current.error) {
    return data(
      {},
      await flash(request, error(current.error, "Failed to load the project"))
    );
  }
  const { projectStock, planningGroupId, planningPriority, ...rest } = fields;

  // Planning group (Projects Phase 3): only a project with project stock may
  // join, and only a group at the project's location. Joining or leaving
  // changes planning only; open stock stays in the project's stripe.
  const hasProjectStock =
    current.data.status === "Draft"
      ? (projectStock ?? false)
      : current.data.projectStock;
  if (planningGroupId) {
    if (!hasProjectStock) {
      return validationError({
        fieldErrors: {
          planningGroupId: "Only a project with project stock can join a group"
        }
      });
    }
    const group = await client
      .from("planningGroup")
      .select("id, locationId")
      .eq("id", planningGroupId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (group.error || !group.data) {
      return validationError({
        fieldErrors: { planningGroupId: "Choose a planning group" }
      });
    }
    if (group.data.locationId !== fields.locationId) {
      return validationError({
        fieldErrors: {
          planningGroupId: "The group must be at the project's location"
        }
      });
    }
  }

  const update = await updateProject(client, {
    ...rest,
    ...(current.data.status === "Draft"
      ? { projectStock: projectStock ?? false }
      : {}),
    planningGroupId: hasProjectStock
      ? (planningGroupId ?? undefined)
      : undefined,
    ...(planningPriority !== undefined ? { planningPriority } : {}),
    id: projectId,
    companyId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update the project"))
    );
  }

  // A released project that becomes Capitalize needs its assets under
  // construction before it takes charges.
  if (fields.costTreatment === "Capitalize") {
    if (current.data.status !== "Draft") {
      try {
        await ensureCapitalAssets(getDatabaseClient(), {
          companyId,
          userId,
          projectId
        });
      } catch (err) {
        logger.error("Failed to create the capital assets", {
          companyId,
          projectId,
          error: err
        });
        throw redirect(
          path.to.projectDetails(projectId),
          await flash(
            request,
            error(err, "Failed to create the assets under construction")
          )
        );
      }
    }
  }

  throw redirect(
    path.to.projectDetails(projectId),
    await flash(request, success("Project updated"))
  );
}

export default function ProjectDetailsRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const routeData = useRouteData<{
    project: Project;
    milestones: ProjectMilestone[];
  }>(path.to.project(projectId));
  const project = routeData?.project;
  if (!project) return null;

  return (
    <VStack spacing={4} className="p-4 max-w-[80rem] mx-auto">
      <ProjectForm
        key={project.id}
        isDisabled={project.status === "Closed"}
        initialValues={{
          id: project.id,
          name: project.name,
          identifier: project.identifier ?? undefined,
          description: project.description ?? undefined,
          // By Coverage belongs to Service projects, which never open here.
          costTreatment:
            project.costTreatment === "By Coverage"
              ? "Expense"
              : project.costTreatment,
          costAccountId: project.costAccountId ?? undefined,
          fixedAssetClassId: project.fixedAssetClassId ?? undefined,
          customerId: project.customerId ?? undefined,
          ownerId: project.ownerId ?? undefined,
          locationId: project.locationId ?? undefined,
          startDate: project.startDate ?? undefined,
          endDate: project.endDate ?? undefined,
          priority: project.priority ?? undefined,
          lockPlanAfterMilestoneId:
            project.lockPlanAfterMilestoneId ?? undefined,
          projectStock: project.projectStock,
          chargeAtReceipt: project.chargeAtReceipt,
          governmentFurnished: project.governmentFurnished,
          planningGroupId: project.planningGroupId ?? undefined,
          planningPriority: project.planningPriority,
          costObjective: project.costObjective ?? undefined,
          restrictCharging: project.restrictCharging
        }}
        isProjectStockLocked={project.status !== "Draft"}
        milestones={(routeData?.milestones ?? []).map((milestone) => ({
          value: milestone.id,
          label: milestone.name
        }))}
      />
    </VStack>
  );
}
