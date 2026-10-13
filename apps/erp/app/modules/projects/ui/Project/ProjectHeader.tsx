// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DropdownMenuCheckboxItem,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  LuBuilding2,
  LuCheck,
  LuChevronDown,
  LuCircleCheck,
  LuCirclePause,
  LuCirclePlay,
  LuCopy,
  LuGitPullRequestArrow,
  LuHistory,
  LuLock,
  LuOctagonX,
  LuRocket,
  LuRotateCcw
} from "react-icons/lu";
import { Link, useFetcher, useNavigate, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import { RecordHeader } from "~/components/Layout/RecordHeader";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectStatus as ProjectStatusType } from "../../projects.models";
import { canChangeProjectStatus } from "../../projects.models";
import type { Project } from "../../types";
import { PlaceInServiceModal } from "../Element/PlaceInServiceModal";
import ProjectStatus from "../Projects/ProjectStatus";
import StopWorkModal from "./StopWorkModal.ee";

type ProjectSwitcherOption = { id: string; identifier: string; name: string };

/**
 * The project workspace's one-line header (Layer 2): on the left the
 * identifier and name (a button that opens the project switcher) and the
 * status; on the right the copy button and the ⋯ menu. There is no primary
 * button (Brad, 2026-10-12): the menu opens with the status transitions, the
 * next step first, then everything else. Facts and exceptions (owner, cost
 * treatment, stop-work, overdue borrows) are on the Overview page.
 */
const ProjectHeader = () => {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const { toggleExplorer } = usePanels();

  const routeData = useRouteData<{
    project: Project;
    underConstructionAssets: number;
    switcherOptions: ProjectSwitcherOption[];
  }>(path.to.project(projectId));
  const project = routeData?.project;
  const [placing, setPlacing] = useState(false);
  const [stoppingWork, setStoppingWork] = useState(false);

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
  // A stop-work order keeps the project On Hold until Resume work (C16).
  const stopWorkDate = project.stopWorkDate;
  const can = (to: ProjectStatusType) =>
    canUpdate && !stopWorkDate && canChangeProjectStatus(status, to);
  const canPlaceInService =
    project.costTreatment === "Capitalize" &&
    (routeData?.underConstructionAssets ?? 0) > 0;
  const showStopWork =
    status === "Released" && project.costObjective === "Direct";

  const resumeWork = () =>
    resumeFetcher.submit(
      { intent: "resume" },
      { method: "post", action: path.to.projectStopWork(projectId) }
    );

  // Brad, 2026-10-12: the header has no primary button. The status
  // transitions open the ⋯ menu, the next step first. A stop-work order
  // overrides them, because nothing else can change until work resumes.
  const transitions: ReactNode = stopWorkDate ? (
    <DropdownMenuItem disabled={!canUpdate || isChanging} onClick={resumeWork}>
      <DropdownMenuIcon icon={<LuCirclePlay />} />
      <Trans>Resume work</Trans>
    </DropdownMenuItem>
  ) : (
    <>
      {status === "Draft" && (
        <DropdownMenuItem
          disabled={!can("Released") || isChanging}
          onClick={() => changeStatus("Released")}
        >
          <DropdownMenuIcon icon={<LuRocket />} />
          <Trans>Release</Trans>
        </DropdownMenuItem>
      )}
      {status === "Released" && (
        <DropdownMenuItem
          disabled={!can("Technically Complete") || isChanging}
          onClick={() => changeStatus("Technically Complete")}
        >
          <DropdownMenuIcon icon={<LuCircleCheck />} />
          <Trans>Work complete</Trans>
        </DropdownMenuItem>
      )}
      {status === "On Hold" && (
        <DropdownMenuItem
          disabled={!can("Released") || isChanging}
          onClick={() => changeStatus("Released")}
        >
          <DropdownMenuIcon icon={<LuCirclePlay />} />
          <Trans>Resume</Trans>
        </DropdownMenuItem>
      )}
      {status === "Technically Complete" && (
        <DropdownMenuItem
          disabled={!can("Closed") || isChanging}
          onClick={closeDisclosure.onOpen}
        >
          <DropdownMenuIcon icon={<LuLock />} />
          <Trans>Close</Trans>
        </DropdownMenuItem>
      )}
    </>
  );

  const menu = (
    <>
      {transitions}
      {!stopWorkDate && status === "Released" && (
        <DropdownMenuItem
          disabled={!can("On Hold") || isChanging}
          onClick={() => changeStatus("On Hold")}
        >
          <DropdownMenuIcon icon={<LuCirclePause />} />
          <Trans>Put on hold</Trans>
        </DropdownMenuItem>
      )}
      {!stopWorkDate && status === "On Hold" && (
        <DropdownMenuItem
          disabled={!can("Technically Complete") || isChanging}
          onClick={() => changeStatus("Technically Complete")}
        >
          <DropdownMenuIcon icon={<LuCircleCheck />} />
          <Trans>Work complete</Trans>
        </DropdownMenuItem>
      )}
      {!stopWorkDate && status === "Technically Complete" && (
        <DropdownMenuItem
          disabled={!can("Released") || isChanging}
          onClick={() => changeStatus("Released")}
        >
          <DropdownMenuIcon icon={<LuRotateCcw />} />
          <Trans>Reopen</Trans>
        </DropdownMenuItem>
      )}
      {canPlaceInService && (
        <DropdownMenuItem
          disabled={!canUpdate || !permissions.can("create", "accounting")}
          onClick={() => setPlacing(true)}
        >
          <DropdownMenuIcon icon={<LuBuilding2 />} />
          <Trans>Place in service</Trans>
        </DropdownMenuItem>
      )}
      {showStopWork && (
        <DropdownMenuItem
          disabled={!canUpdate}
          onClick={() => setStoppingWork(true)}
        >
          <DropdownMenuIcon icon={<LuOctagonX />} />
          <Trans>Stop work</Trans>
        </DropdownMenuItem>
      )}
      {(status !== "Closed" || canPlaceInService) && <DropdownMenuSeparator />}
      <DropdownMenuItem asChild>
        <Link to={path.to.projectBaselines(projectId)}>
          <DropdownMenuIcon icon={<LuHistory />} />
          <Trans>Baselines</Trans>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to={path.to.projectChangeRequests(projectId)}>
          <DropdownMenuIcon icon={<LuGitPullRequestArrow />} />
          <Trans>Change requests</Trans>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!permissions.can("create", "projects")}
        asChild
      >
        <Link to={`${path.to.newProject}?copyFrom=${projectId}`}>
          <DropdownMenuIcon icon={<LuCopy />} />
          <Trans>Copy project</Trans>
        </Link>
      </DropdownMenuItem>
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
    </>
  );

  return (
    <>
      <RecordHeader
        title={
          <ProjectSwitcher
            projectId={projectId}
            project={project}
            options={routeData?.switcherOptions ?? []}
          />
        }
        copyValue={project.identifier ?? ""}
        menu={menu}
        status={<ProjectStatus status={status} />}
        onToggleExplorer={toggleExplorer}
        toolsPlacement="end"
      />
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

/**
 * The identifier and name as a quiet button; it opens a searchable list of
 * the company's projects. Choosing one opens the same page of that project.
 */
function ProjectSwitcher({
  projectId,
  project,
  options
}: {
  projectId: string;
  project: Project;
  options: ProjectSwitcherOption[];
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const location = useOptimisticLocation();
  const [open, setOpen] = useState(false);

  // The page under /x/project/<id>, without a record of this project (an
  // element, a change request), so it exists in the other project too.
  const projectRoot = path.to.project(projectId);
  const segment =
    location.pathname.slice(projectRoot.length).split("/")[1] ?? "";
  // An element's full page has no list of its own: go to the Plan page.
  const page = segment === "element" ? "elements" : segment;
  const switchTo = (id: string) => {
    setOpen(false);
    if (id === projectId) return;
    navigate(page ? `${path.to.project(id)}/${page}` : path.to.project(id));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={t`Switch project`}
          className="-mx-1.5 flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="shrink-0 whitespace-nowrap">
            {project.identifier}
          </span>
          <span className="min-w-0 truncate font-normal text-muted-foreground">
            {project.name}
          </span>
          <LuChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t`Search projects`} className="h-9" />
          <CommandList>
            <CommandEmpty>
              <Trans>No project found</Trans>
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.identifier} ${option.name}`}
                  onSelect={() => switchTo(option.id)}
                  className="gap-2"
                >
                  <span className="min-w-14 shrink-0 font-medium">
                    {option.identifier}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {option.name}
                  </span>
                  <LuCheck
                    className={
                      option.id === projectId
                        ? "ml-auto size-4 shrink-0"
                        : "ml-auto size-4 shrink-0 opacity-0"
                    }
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default ProjectHeader;
