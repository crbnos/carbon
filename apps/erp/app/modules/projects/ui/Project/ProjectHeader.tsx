// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { stopWorkDaysLeft, stopWorkEnd } from "@carbon/ee/project-control";
import {
  Badge,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useState } from "react";
import {
  LuBuilding2,
  LuCircleCheck,
  LuCirclePause,
  LuCirclePlay,
  LuCopy,
  LuEllipsisVertical,
  LuHandCoins,
  LuLock,
  LuOctagonX,
  LuRocket,
  LuRotateCcw
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { EmployeeAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { DetailsTopbar } from "~/components/Layout";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { useCompanyToday, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectStatus as ProjectStatusType } from "../../projects.models";
import { canChangeProjectStatus } from "../../projects.models";
import type { Project } from "../../types";
import { PlaceInServiceModal } from "../Element/PlaceInServiceModal";
import ProjectStatus from "../Projects/ProjectStatus";
import StopWorkModal from "./StopWorkModal.ee";
import { useProjectNavigation } from "./useProjectNavigation";

const ProjectHeader = () => {
  const { t } = useLingui();
  const links = useProjectNavigation();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");

  const routeData = useRouteData<{
    project: Project;
    underConstructionAssets: number;
    overdueBorrowCount: number;
  }>(path.to.project(projectId));
  const overdueBorrowCount = routeData?.overdueBorrowCount ?? 0;
  const project = routeData?.project;
  const [placing, setPlacing] = useState(false);
  const [stoppingWork, setStoppingWork] = useState(false);
  const { locale } = useLocale();
  const today = useCompanyToday();

  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "projects");
  const statusFetcher = useFetcher<{}>();
  const templateFetcher = useFetcher<{}>();
  const resumeFetcher = useFetcher<{}>();
  const isChanging =
    statusFetcher.state !== "idle" || resumeFetcher.state !== "idle";
  const closeDisclosure = useDisclosure();

  if (!project) return null;

  const status = project.status;
  const changeStatus = (to: ProjectStatusType) => {
    statusFetcher.submit(
      { status: to },
      { method: "post", action: path.to.projectStatus(projectId) }
    );
  };
  // A stop-work order keeps the project On Hold until Resume (C16).
  const stopWorkDate = project.stopWorkDate;
  const can = (to: ProjectStatusType) =>
    canUpdate && !stopWorkDate && canChangeProjectStatus(status, to);
  const canStopWork =
    canUpdate && status === "Released" && project.costObjective === "Direct";

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
          {stopWorkDate && (
            // an exception, not a status: FAR 52.242-15 runs 90 days
            <Badge variant="red" className="shrink-0 gap-1 whitespace-nowrap">
              <LuOctagonX />
              <Trans>
                Stop-work order {formatDate(stopWorkDate, undefined, locale)} ·
                ends {formatDate(stopWorkEnd(stopWorkDate), undefined, locale)}{" "}
                · {stopWorkDaysLeft(today, stopWorkDate)} days left
              </Trans>
            </Badge>
          )}
          {overdueBorrowCount > 0 && (
            // an exception, not a status: an Open borrow past its payback date
            <Link to={path.to.projectStock(projectId)} className="shrink-0">
              <Badge variant="red" className="gap-1 whitespace-nowrap">
                <LuHandCoins />
                <Trans>Overdue borrows: {overdueBorrowCount}</Trans>
              </Badge>
            </Link>
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
          {stopWorkDate && canUpdate && (
            <Button
              variant="primary"
              leftIcon={<LuCirclePlay />}
              isLoading={resumeFetcher.state !== "idle"}
              isDisabled={isChanging}
              onClick={() =>
                resumeFetcher.submit(
                  { intent: "resume" },
                  { method: "post", action: path.to.projectStopWork(projectId) }
                )
              }
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
          {project.costTreatment === "Capitalize" &&
            (routeData?.underConstructionAssets ?? 0) > 0 && (
              <Button
                variant="secondary"
                leftIcon={<LuBuilding2 />}
                isDisabled={
                  !canUpdate || !permissions.can("create", "accounting")
                }
                onClick={() => setPlacing(true)}
              >
                <Trans>Place in service</Trans>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More`}
                icon={<LuEllipsisVertical />}
                variant="secondary"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuCheckboxItem
                checked={
                  templateFetcher.formData
                    ? templateFetcher.formData.get("isTemplate") === "true"
                    : project.isTemplate
                }
                disabled={!canUpdate}
                onCheckedChange={(checked) =>
                  templateFetcher.submit(
                    { isTemplate: checked ? "true" : "false" },
                    {
                      method: "post",
                      action: path.to.projectTemplate(projectId)
                    }
                  )
                }
              >
                <Trans>Template</Trans>
              </DropdownMenuCheckboxItem>
              {canStopWork && (
                <DropdownMenuItem onClick={() => setStoppingWork(true)}>
                  <DropdownMenuIcon icon={<LuOctagonX />} />
                  <Trans>Stop work</Trans>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={!permissions.can("create", "projects")}
                asChild
              >
                <Link to={`${path.to.newProject}?copyFrom=${projectId}`}>
                  <DropdownMenuIcon icon={<LuCopy />} />
                  <Trans>Copy project</Trans>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DetailsTopbar links={links} />
        </HStack>
      </div>
      {stoppingWork && (
        <StopWorkModal
          projectId={projectId}
          onClose={() => setStoppingWork(false)}
        />
      )}
      {placing && (
        <PlaceInServiceModal
          projectId={projectId}
          onClose={() => setPlacing(false)}
        />
      )}
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
