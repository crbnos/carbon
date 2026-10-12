// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheck, LuChevronsUpDown, LuHistory } from "react-icons/lu";
import { Link, useNavigate, useParams } from "react-router";
import { DetailSidebar } from "~/components/Layout";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Project } from "../../types";
import type { ActiveChangeRequest } from "../ChangeRequests/ChangeRequestBanner";
import { ChangeRequestPicker } from "../ChangeRequests/ChangeRequestPicker";
import type { ProjectTreeElement } from "./ProjectElementTree";
import { ProjectElementTree } from "./ProjectElementTree";
import { useProjectSidebarLinks } from "./useProjectNavigation";

type ProjectSwitcherOption = { id: string; identifier: string; name: string };

/** What `$projectId.tsx` loads for the sidebar. */
export type ProjectSidebarData = {
  project: Project;
  treeElements: ProjectTreeElement[];
  switcherOptions: ProjectSwitcherOption[];
  openChangeRequests: ActiveChangeRequest[];
  activeChangeRequest: ActiveChangeRequest | null;
  hasBillingLines: boolean;
};

/**
 * The project workspace's left panel (Layer 2), top to bottom: the project
 * switcher; the plan on screen (the live plan or a change request) with the
 * baselines link; the page links; the element tree while a Plan page is
 * open; Settings pinned at the bottom.
 */
export function ProjectSidebar() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const location = useOptimisticLocation();
  const permissions = usePermissions();
  const data = useRouteData<ProjectSidebarData>(path.to.project(projectId));
  const { links, settings } = useProjectSidebarLinks({
    hasBillingLines: data?.hasBillingLines ?? false
  });

  if (!data) return null;
  const { project } = data;
  const isClosed = project.status === "Closed";
  const isPlanPage =
    location.pathname.startsWith(path.to.projectElements(projectId)) ||
    location.pathname.startsWith(`${path.to.project(projectId)}/element/`);
  const isBaselines = location.pathname.startsWith(
    path.to.projectBaselines(projectId)
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <ProjectSwitcher
        projectId={projectId}
        project={project}
        options={data.switcherOptions}
      />
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
      {isPlanPage ? (
        <ProjectElementTree
          projectId={projectId}
          elements={data.treeElements}
          className="flex-1 border-t border-border pt-2"
        />
      ) : (
        <div className="flex-1" />
      )}
      <div className="shrink-0 border-t border-border pt-2">
        <DetailSidebar links={[settings]} />
      </div>
    </div>
  );
}

/**
 * The project name as a quiet button; it opens a searchable list of the
 * company's projects. Choosing one opens the same page of that project.
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
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label={t`Switch project`}
          rightIcon={<LuChevronsUpDown className="ml-auto opacity-60" />}
          className="w-full justify-start px-2"
        >
          <span className="block min-w-0 flex-1 truncate text-left">
            <span className="font-medium">{project.identifier}</span>
            <span className="text-muted-foreground"> · {project.name}</span>
          </span>
        </Button>
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
                >
                  <span className="shrink-0 font-medium">
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
