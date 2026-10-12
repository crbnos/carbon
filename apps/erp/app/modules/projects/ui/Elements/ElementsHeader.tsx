// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutKeyMap
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { IconType } from "react-icons";
import {
  LuBookOpenText,
  LuBoxes,
  LuChevronDown,
  LuFileText,
  LuGitPullRequestArrow,
  LuLock,
  LuNetwork,
  LuPlus,
  LuSheet
} from "react-icons/lu";
import { Link } from "react-router";
import { SearchFilter } from "~/components";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useUrlParams } from "~/hooks";
import { PROJECT_SHORTCUTS } from "~/shortcuts";
import type { ProjectElementType, ProjectLayout } from "../../projects.models";
import { projectElementTypes, projectLayouts } from "../../projects.models";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";

export const elementLayouts = projectLayouts;
export type ElementLayout = ProjectLayout;

const layoutIcons: Record<ElementLayout, IconType> = {
  table: LuSheet,
  tree: LuNetwork,
  reader: LuBookOpenText
};

type ElementsHeaderProps = {
  count: number;
  layout: ElementLayout;
  filters: ColumnFilter[];
  /** Focuses the quick-add input, with a type or the current one. */
  onNew: (type?: ProjectElementType) => void;
  /** Opens Build from part. */
  onBuildFromPart: () => void;
  canCreate: boolean;
  /** The Reader's PDF, with the current filters; shown when set. */
  exportHref?: string;
  /**
   * Set while the plan is locked and no change request is open: the lock
   * message, and the change requests page that opens one.
   */
  planLock?: { message: string; changeRequestsHref: string } | null;
};

export function ElementsHeader({
  count,
  layout,
  filters,
  onNew,
  onBuildFromPart,
  canCreate,
  exportHref,
  planLock
}: ElementsHeaderProps) {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();
  useShortcutKeyMap(
    [
      {
        shortcut: PROJECT_SHORTCUTS.create,
        action: (event) => {
          event.preventDefault();
          onNew();
        }
      }
    ],
    { disabled: !canCreate }
  );
  const typeLabels = useElementTypeLabels();
  const layoutLabels: Record<ElementLayout, string> = {
    table: t`Table`,
    tree: t`Tree`,
    reader: t`Reader`
  };
  const LayoutIcon = layoutIcons[layout];
  const hasFilters = params.getAll("filter").filter(Boolean).length > 0;

  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
        <HStack spacing={2} className="min-w-0 flex-1">
          <Heading size="h4" className="shrink-0">
            <Trans>Elements</Trans>
          </Heading>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {count}
          </Badge>
        </HStack>

        <HStack spacing={2} className="shrink-0">
          {planLock && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <LuLock className="size-3.5" />
                    <Trans>Plan locked</Trans>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{planLock.message}</TooltipContent>
              </Tooltip>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LuGitPullRequestArrow />}
                asChild
              >
                <Link to={planLock.changeRequestsHref}>
                  <Trans>Open Change Request</Trans>
                </Link>
              </Button>
            </>
          )}
          <SearchFilter param="search" size="sm" placeholder={t`Search`} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                leftIcon={<LayoutIcon />}
                rightIcon={<LuChevronDown />}
              >
                {layoutLabels[layout]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuRadioGroup
                value={layout}
                onValueChange={(next) => setParams({ layout: next })}
              >
                {elementLayouts.map((value) => {
                  const Icon = layoutIcons[value];
                  return (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <DropdownMenuIcon icon={<Icon />} />
                      {layoutLabels[value]}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {exportHref && (
            <Button variant="secondary" leftIcon={<LuFileText />} asChild>
              <a href={exportHref} target="_blank" rel="noreferrer">
                <Trans>Export PDF</Trans>
              </a>
            </Button>
          )}
          {!hasFilters && <Filter filters={filters} />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                leftIcon={<LuPlus />}
                rightIcon={<LuChevronDown />}
                isDisabled={!canCreate}
              >
                <Trans>New</Trans>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {projectElementTypes.map((value) => (
                <DropdownMenuItem key={value} onClick={() => onNew(value)}>
                  <DropdownMenuIcon icon={<ElementTypeIcon type={value} />} />
                  {typeLabels[value]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onBuildFromPart}>
                <DropdownMenuIcon icon={<LuBoxes />} />
                <Trans>Build from part</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </div>
      {hasFilters && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-1.5">
          <ActiveFilters filters={filters} />
        </div>
      )}
    </div>
  );
}
