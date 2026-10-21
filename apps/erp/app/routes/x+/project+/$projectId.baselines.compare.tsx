// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import {
  CURRENT_PLAN,
  diffPlanSnapshots,
  parsePlanSnapshot
} from "~/modules/projects/projects.models";
import { loadPlanSnapshot } from "~/modules/projects/projects.server";
import {
  getLaborCategoryNames,
  getProjectBaseline
} from "~/modules/projects/projects.service";
import PlanDiffViewer from "~/modules/projects/ui/Baselines/PlanDiffViewer";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-baseline-compare");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const searchParams = new URL(request.url).searchParams;
  const fromId = searchParams.get("from");
  const toId = searchParams.get("to") || CURRENT_PLAN;

  const refuse = async (err: unknown, message: string) =>
    redirect(
      path.to.projectBaselines(projectId),
      await flash(request, error(err, message))
    );

  if (!fromId) throw await refuse(null, "Choose a baseline to compare");

  const [from, to] = await Promise.all([
    getProjectBaseline(client, fromId, companyId),
    toId === CURRENT_PLAN
      ? Promise.resolve(null)
      : getProjectBaseline(client, toId, companyId)
  ]);

  if (from.error || from.data?.projectId !== projectId) {
    logger.error("Failed to load the baseline", {
      companyId,
      projectId,
      fromId,
      error: from.error
    });
    throw await refuse(from.error, "Failed to load the baseline");
  }
  if (to && (to.error || to.data?.projectId !== projectId)) {
    logger.error("Failed to load the baseline", {
      companyId,
      projectId,
      toId,
      error: to.error
    });
    throw await refuse(to.error, "Failed to load the baseline");
  }

  const targetSnapshot = to?.data
    ? parsePlanSnapshot(to.data.snapshot)
    : await loadPlanSnapshot(getDatabaseClient(), { companyId, projectId });
  const diff = diffPlanSnapshots(
    parsePlanSnapshot(from.data.snapshot),
    targetSnapshot
  );

  // Labor lines name their category; read the names once, active or not.
  const laborCategoryIds = [
    ...new Set(
      diff.labor
        .flatMap((entry) => [
          entry.before?.laborCategoryId,
          entry.after?.laborCategoryId
        ])
        .filter((id): id is string => typeof id === "string")
    )
  ];
  const laborCategories =
    laborCategoryIds.length > 0
      ? await getLaborCategoryNames(client, laborCategoryIds, companyId)
      : null;
  if (laborCategories?.error) {
    logger.error("Failed to load labor categories", {
      companyId,
      error: laborCategories.error
    });
  }

  return {
    fromId: from.data.id,
    toId: to?.data?.id ?? CURRENT_PLAN,
    diff,
    laborCategoryNames: Object.fromEntries(
      (laborCategories?.data ?? []).map((c) => [c.id, c.name])
    ) as Record<string, string>
  };
}

export default function ProjectBaselineCompareRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const { fromId, toId, diff, laborCategoryNames } =
    useLoaderData<typeof loader>();

  return (
    <PlanDiffViewer
      projectId={projectId}
      fromId={fromId}
      toId={toId}
      diff={diff}
      laborCategoryNames={laborCategoryNames}
    />
  );
}
