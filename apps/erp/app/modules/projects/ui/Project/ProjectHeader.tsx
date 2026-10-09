// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, Copy, Heading, HStack, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCirclePause,
  LuCirclePlay,
  LuLock,
  LuRocket,
  LuRotateCcw
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { EmployeeAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { DetailsTopbar } from "~/components/Layout";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectStatus as ProjectStatusType } from "../../projects.models";
import { canChangeProjectStatus } from "../../projects.models";
import type { Project } from "../../types";
import ProjectStatus from "../Projects/ProjectStatus";
import { useProjectNavigation } from "./useProjectNavigation";

const ProjectHeader = () => {
  const { t } = useLingui();
  const links = useProjectNavigation();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");

  const routeData = useRouteData<{ project: Project }>(
    path.to.project(projectId)
  );
  const project = routeData?.project;

  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "projects");
  const statusFetcher = useFetcher<{}>();
  const isChanging = statusFetcher.state !== "idle";
  const closeDisclosure = useDisclosure();

  if (!project) return null;

  const status = project.status;
  const changeStatus = (to: ProjectStatusType) => {
    statusFetcher.submit(
      { status: to },
      { method: "post", action: path.to.projectStatus(projectId) }
    );
  };
  const can = (to: ProjectStatusType) =>
    canUpdate && canChangeProjectStatus(status, to);

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <HStack className="min-w-0 flex-1">
          <Link to={path.to.projectDetails(projectId)} className="shrink-0">
            <Heading size="h4" className="flex items-center gap-2">
              <span className="whitespace-nowrap">{project.identifier}</span>
            </Heading>
          </Link>
          <Copy text={project.identifier ?? ""} />
          <span className="truncate text-sm text-muted-foreground">
            {project.name}
          </span>
          <ProjectStatus status={status} />
          <Enumerable value={project.costTreatment} />
          {project.ownerId && (
            <EmployeeAvatar employeeId={project.ownerId} size="xs" />
          )}
        </HStack>
        <HStack className="shrink-0">
          {can("Released") && status === "Draft" && (
            <Button
              variant="primary"
              leftIcon={<LuRocket />}
              isLoading={isChanging}
              isDisabled={isChanging}
              onClick={() => changeStatus("Released")}
            >
              <Trans>Release</Trans>
            </Button>
          )}
          {can("On Hold") && (
            <Button
              variant="secondary"
              leftIcon={<LuCirclePause />}
              isLoading={isChanging}
              isDisabled={isChanging}
              onClick={() => changeStatus("On Hold")}
            >
              <Trans>Put on hold</Trans>
            </Button>
          )}
          {can("Released") && status === "On Hold" && (
            <Button
              variant="primary"
              leftIcon={<LuCirclePlay />}
              isLoading={isChanging}
              isDisabled={isChanging}
              onClick={() => changeStatus("Released")}
            >
              <Trans>Resume</Trans>
            </Button>
          )}
          {can("Technically Complete") && (
            <Button
              variant={status === "Released" ? "primary" : "secondary"}
              leftIcon={<LuCircleCheck />}
              isLoading={isChanging}
              isDisabled={isChanging}
              onClick={() => changeStatus("Technically Complete")}
            >
              <Trans>Technically complete</Trans>
            </Button>
          )}
          {can("Released") && status === "Technically Complete" && (
            <Button
              variant="secondary"
              leftIcon={<LuRotateCcw />}
              isLoading={isChanging}
              isDisabled={isChanging}
              onClick={() => changeStatus("Released")}
            >
              <Trans>Reopen</Trans>
            </Button>
          )}
          {can("Closed") && (
            <Button
              variant="primary"
              leftIcon={<LuLock />}
              isDisabled={isChanging}
              onClick={closeDisclosure.onOpen}
            >
              <Trans>Close</Trans>
            </Button>
          )}
          <DetailsTopbar links={links} />
        </HStack>
      </div>
      {closeDisclosure.isOpen && (
        <Confirm
          action={path.to.projectStatus(projectId)}
          title={t`Close ${project.identifier}`}
          text={t`A closed project takes no more charges and cannot be reopened. Close it only when every purchase order line and job on it is done.`}
          confirmText={t`Close Project`}
          onCancel={closeDisclosure.onClose}
          onSubmit={closeDisclosure.onClose}
        >
          <input type="hidden" name="status" value="Closed" />
        </Confirm>
      )}
    </>
  );
};

export default ProjectHeader;
