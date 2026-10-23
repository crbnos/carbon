// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { parseDate, toZoned } from "@internationalized/date";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { getProjectPegs } from "~/modules/projects/projects.service";
import ProjectPegging from "~/modules/projects/ui/Pegging/ProjectPegging";
import PlanningGroupsUpgradeOverlay from "~/modules/projects/ui/PlanningGroups/PlanningGroupsUpgradeOverlay";

const logger = getLogger("erp", "project-pegging");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The project's pegs (Projects Phase 3). With `?asOf=YYYY-MM-DD`, the pegs
 * that were current at the end of that day on the company's calendar. The
 * page loads with no plan check: a gated company sees the upgrade overlay,
 * and the Manual peg route enforces the plan.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const asOfParam = new URL(request.url).searchParams.get("asOf");
  const asOfDate = asOfParam && DATE_PATTERN.test(asOfParam) ? asOfParam : null;

  // The end of the chosen day is the start of the next one in the company's
  // timezone.
  const asOf = asOfDate
    ? toZoned(
        parseDate(asOfDate).add({ days: 1 }),
        await getCompanyTimeZone(client, companyId)
      ).toAbsoluteString()
    : null;

  const pegs = await getProjectPegs(client, { companyId, projectId, asOf });
  if (pegs.error) {
    logger.error("Failed to load the project's pegs", {
      companyId,
      projectId,
      error: pegs.error
    });
  }

  return { pegs: pegs.data, asOfDate };
}

export default function ProjectPeggingRoute() {
  const { pegs, asOfDate } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "PLANNING_GROUPS" });

  if (isGated) return <PlanningGroupsUpgradeOverlay />;

  return (
    <>
      <ProjectPegging pegs={pegs} asOfDate={asOfDate} />
      <RecordOutlet />
    </>
  );
}
