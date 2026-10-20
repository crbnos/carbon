// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuHistory } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { DetailSidebar } from "~/components/Layout";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isProjectPlanLocked } from "../../projects.models";
import type { Project } from "../../types";
import type { ActiveChangeRequest } from "../ChangeRequests/ChangeRequestBanner";
import { ChangeRequestPicker } from "../ChangeRequests/ChangeRequestPicker";
import type { ProjectTreeElement } from "./ProjectElementTree";
import { ProjectElementTree } from "./ProjectElementTree";
import { useProjectSidebarLinks } from "./useProjectNavigation";

/** What `$projectId.tsx` loads for the sidebar. */
export type ProjectSidebarData = {
  project: Project;
  treeElements: ProjectTreeElement[];
  milestones: { id: string; completedAt: string | null }[];
  openChangeRequests: ActiveChangeRequest[];
  activeChangeRequest: ActiveChangeRequest | null;
  hasBillingLines: boolean;
  hasProjectStock: boolean;
  hasPegs: boolean;
};

/**
 * The project workspace's left panel (Layer 2), top to bottom: the plan on
 * screen (the live plan or a change request) with the baselines link; the
 * page links, Settings last; the element tree while a Plan page is open. The
 * project name and switcher are in the header.
 */
export function ProjectSidebar() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const location = useOptimisticLocation();
  const permissions = usePermissions();
  const data = useRouteData<ProjectSidebarData>(path.to.project(projectId));
  const links = useProjectSidebarLinks({
    hasBillingLines: data?.hasBillingLines ?? false,
    hasProjectStock: data?.hasProjectStock ?? false,
    hasPegs: data?.hasPegs ?? false
  });

  if (!data) return null;
  const { project } = data;
  const isClosed = project.status === "Closed";
  const isPlanPage =
    location.pathname.startsWith(path.to.projectElements(projectId)) ||
    location.pathname.startsWith(`${path.to.project(projectId)}/element/`);
  // A move is a plan-layer write: a Draft change request takes it, and a
  // locked plan takes it only that way (the move route's own check).
  const lockMilestone = data.milestones.find(
    (milestone) => milestone.id === project.lockPlanAfterMilestoneId
  );
  const canMoveElements =
    permissions.can("update", "projects") &&
    !isClosed &&
    (data.activeChangeRequest
      ? data.activeChangeRequest.status === "Draft"
      : !isProjectPlanLocked({ lockMilestone }));
  const isBaselines = location.pathname.startsWith(
    path.to.projectBaselines(projectId)
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <ChangeRequestPicker
          projectId={projectId}
          changeRequests={data.openChangeRequests}
          active={data.activeChangeRequest}
          canCreate={permissions.can("update", "projects") && !isClosed}
          className="min-w-0 max-w-none flex-1"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              isIcon
              variant={isBaselines ? "active" : "secondary"}
              aria-label={t`Baselines`}
            >
              <Link to={path.to.projectBaselines(projectId)}>
                <LuHistory />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Trans>Baselines</Trans>
          </TooltipContent>
        </Tooltip>
      </div>
      <nav aria-label={t`Project pages`} className="shrink-0">
        <DetailSidebar links={links} />
      </nav>
      {isPlanPage && (
        <ProjectElementTree
          projectId={projectId}
          elements={data.treeElements}
          canMove={canMoveElements}
          className="flex-1 border-t border-border pt-2"
        />
      )}
    </div>
  );
}
