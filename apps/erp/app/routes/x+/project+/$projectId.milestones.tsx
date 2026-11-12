// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyTimeZone } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  useLoaderData,
  useParams,
  useSearchParams
} from "react-router";
import { useRouteData } from "~/hooks";
import {
  buildBurnSeries,
  projectMilestoneValidator,
  summarizeMilestones
} from "~/modules/projects/projects.models";
import {
  getProjectCostSummary,
  getProjectElements,
  getProjectMilestones
} from "~/modules/projects/projects.service";
import type { Project } from "~/modules/projects/types";
import MilestoneSchedule from "~/modules/projects/ui/Milestones/MilestoneSchedule";
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

  // The burn of the selected milestone: its elements' Posted timesheet hours
  // and shop hours (the Labor quantity of job ledger rows; a DCAA timesheet's
  // rows are already in the timesheet hours), one query each.
  const selectedId = new URL(request.url).searchParams.get("milestone");
  const selected = summaries.find((m) => m.id === selectedId) ?? null;
  let burn: {
    milestoneId: string;
    plannedHours: number;
    series: ReturnType<typeof buildBurnSeries>;
  } | null = null;
  if (selected) {
    const elementIds = (elements.data ?? [])
      .filter((element) => element.milestoneId === selected.id)
      .map((element) => element.id);
    const endDate =
      elementIds.length > 0 && selected.startDate ? selected.endDate : null;
    const [entries, shopHours] = endDate
      ? await Promise.all([
          client
            .from("timesheetEntry")
            .select("entryDate, hours")
            .eq("companyId", companyId)
            .eq("projectId", projectId)
            .eq("status", "Posted")
            .in("projectElementId", elementIds)
            .lte("entryDate", endDate),
          client
            .from("projectLedger")
            .select("postingDate, quantity")
            .eq("companyId", companyId)
            .eq("projectId", projectId)
            .eq("costType", "Labor")
            .not("jobId", "is", null)
            .neq("documentType", "Timesheet")
            .not("quantity", "is", null)
            .in("projectElementId", elementIds)
            .lte("postingDate", endDate)
        ])
      : [
          { data: [], error: null },
          { data: [], error: null }
        ];
    if (entries.error) {
      logger.error("Failed to load the milestone's posted hours", {
        companyId,
        projectId,
        milestoneId: selected.id,
        error: entries.error
      });
    }
    if (shopHours.error) {
      logger.error("Failed to load the milestone's shop hours", {
        companyId,
        projectId,
        milestoneId: selected.id,
        error: shopHours.error
      });
    }
    burn = {
      milestoneId: selected.id,
      plannedHours: selected.estimatedHours,
      series:
        selected.startDate && selected.endDate
          ? buildBurnSeries({
              startDate: selected.startDate,
              endDate: selected.endDate,
              plannedHours: selected.estimatedHours,
              entries: [
                ...(entries.data ?? []).map((entry) => ({
                  entryDate: entry.entryDate,
                  hours: Number(entry.hours)
                })),
                ...(shopHours.data ?? []).map((row) => ({
                  entryDate: row.postingDate,
                  hours: Number(row.quantity)
                }))
              ],
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

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const intent = formData.get("intent") as Intent | null;
  const id = formData.get("id");

  const refuse = async (message: string) =>
    data({ success: false }, await flash(request, error(null, message)));
  const done = async (message: string) =>
    data({ success: true }, await flash(request, success(message)));

  const api = await carbon(request);

  switch (intent) {
    case "upsert": {
      const validation = await validator(projectMilestoneValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      const result = await api.projects.upsertProjectMilestone({
        ...validation.data,
        projectId
      });
      if (result.error) return refuse(result.error.message);
      return done("Milestone saved");
    }
    case "complete":
    case "reopen": {
      if (typeof id !== "string") return refuse("No milestone was given");
      const result = await api.projects.completeProjectMilestone({
        id,
        completed: intent === "complete"
      });
      if (result.error) return refuse(result.error.message);
      if (intent === "reopen") return done("Milestone reopened");
      // The milestone is saved; a failed baseline only warns.
      if (result.data.baselineFailed) {
        return refuse(
          "Milestone completed, but its baseline could not be written"
        );
      }
      return done("Milestone completed");
    }
    case "delete": {
      if (typeof id !== "string") return refuse("No milestone was given");
      const result = await api.projects.deleteProjectMilestone({ id });
      if (result.error) return refuse(result.error.message);
      return done("Milestone deleted");
    }
    default:
      return refuse("Unknown action");
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
    <MilestoneSchedule
      milestones={milestones}
      action={path.to.projectMilestones(projectId)}
      isDisabled={routeData.project.status === "Closed"}
      today={today}
      selected={burn}
      onSelect={selectMilestone}
    />
  );
}
