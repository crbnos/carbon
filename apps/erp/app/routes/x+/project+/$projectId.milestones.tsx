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
import { data, useLoaderData, useParams, useSearchParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Project } from "~/modules/projects";
import {
  buildBurnSeries,
  completeProjectMilestone,
  deleteProjectMilestone,
  getProjectCostSummary,
  getProjectElements,
  getProjectMilestones,
  projectMilestoneValidator,
  summarizeMilestones,
  upsertProjectMilestone
} from "~/modules/projects";
import { createProjectBaseline } from "~/modules/projects/projects.server";
import { MilestoneBurnChart } from "~/modules/projects/ui/Milestones/MilestoneBurnChart";
import MilestonesList from "~/modules/projects/ui/Milestones/MilestonesList";
import { getDatabaseClient } from "~/services/database.server";
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

  const today = datetime.today(timeZone).toString();
  const summaries = summarizeMilestones({
    milestones: milestones.data ?? [],
    elements: elements.data ?? [],
    costSummary: costSummary.data ?? [],
    today
  });

  // The burn of the selected milestone: its elements' posted hours, in one
  // query.
  const selectedId = new URL(request.url).searchParams.get("milestone");
  const selected = summaries.find((m) => m.id === selectedId) ?? null;
  let burn: {
    milestoneId: string;
    name: string;
    plannedHours: number;
    series: ReturnType<typeof buildBurnSeries>;
  } | null = null;
  if (selected) {
    const elementIds = (elements.data ?? [])
      .filter((element) => element.milestoneId === selected.id)
      .map((element) => element.id);
    const entries =
      elementIds.length > 0 && selected.startDate && selected.endDate
        ? await client
            .from("timesheetEntry")
            .select("entryDate, hours")
            .eq("companyId", companyId)
            .eq("projectId", projectId)
            .eq("status", "Posted")
            .in("projectElementId", elementIds)
            .lte("entryDate", selected.endDate)
        : { data: [], error: null };
    if (entries.error) {
      logger.error("Failed to load the milestone's posted hours", {
        companyId,
        projectId,
        milestoneId: selected.id,
        error: entries.error
      });
    }
    burn = {
      milestoneId: selected.id,
      name: selected.name,
      plannedHours: selected.estimatedHours,
      series:
        selected.startDate && selected.endDate
          ? buildBurnSeries({
              startDate: selected.startDate,
              endDate: selected.endDate,
              plannedHours: selected.estimatedHours,
              entries: (entries.data ?? []).map((entry) => ({
                entryDate: entry.entryDate,
                hours: Number(entry.hours)
              })),
              today
            })
          : []
    };
  }

  return { milestones: summaries, burn, today };
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
      if (intent === "reopen") return done("Milestone reopened");

      // A completed milestone writes a baseline of the plan layer. The
      // milestone is already saved, so a failed baseline only warns.
      try {
        await createProjectBaseline(getDatabaseClient(), {
          companyId,
          userId,
          projectId: result.data.projectId,
          name: `${result.data.name} (completed)`,
          source: "Milestone",
          milestoneId: result.data.id
        });
      } catch (err) {
        logger.error("Failed to write the milestone baseline", {
          err,
          milestoneId: result.data.id
        });
        return refuse(
          err,
          "Milestone completed, but its baseline could not be written"
        );
      }
      return done("Milestone completed");
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

  const { milestones, burn, today } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeData = useRouteData<{ project: Project }>(
    path.to.project(projectId)
  );
  if (!routeData?.project) return null;

  const selectMilestone = (milestoneId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (milestoneId) next.set("milestone", milestoneId);
    else next.delete("milestone");
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <MilestonesList
      projectId={projectId}
      milestones={milestones}
      action={path.to.projectMilestones(projectId)}
      isDisabled={routeData.project.status === "Closed"}
      selectedId={burn?.milestoneId ?? null}
      onSelect={selectMilestone}
      aside={
        burn ? (
          <MilestoneBurnChart
            name={burn.name}
            series={burn.series}
            plannedHours={burn.plannedHours}
            today={today}
            onClose={() => selectMilestone(null)}
          />
        ) : null
      }
    />
  );
}
