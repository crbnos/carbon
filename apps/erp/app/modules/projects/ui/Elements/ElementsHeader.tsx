// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  SplitButton,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutKeyMap
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuBoxes, LuFileText, LuPlus } from "react-icons/lu";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useUrlParams } from "~/hooks";
import { PROJECT_SHORTCUTS } from "~/shortcuts";
import type { ProjectElementType, ProjectLayout } from "../../projects.models";
import { projectElementTypes, projectLayouts } from "../../projects.models";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";

type ElementsHeaderProps = {
  layout: ProjectLayout;
  filters: ColumnFilter[];
  /** Creates an element of the type; a Task when none is given. */
  onNew: (type?: ProjectElementType) => void;
  /** Opens Build from part. */
  onBuildFromPart: () => void;
  canCreate: boolean;
  /** True while a create is posting. */
  isCreating: boolean;
  /** The Reader's PDF, with the current filters; shown when set. */
  exportHref?: string;
  /** The lock message while the plan is locked and no change request is open. */
  planLockMessage?: string | null;
};

/**
 * The Plan page's one toolbar row: the List / Tree / Reader switch on the
 * left; Filter and New Element on the right. The search is the sidebar's
 * "Search elements" box. Filter chips show in a second row only while a
 * filter is set.
 */
export function ElementsHeader({
  layout,
  filters,
  onNew,
  onBuildFromPart,
  canCreate,
  isCreating,
  exportHref,
  planLockMessage
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
  const layoutLabels: Record<ProjectLayout, string> = {
    list: t`List`,
    tree: t`Tree`,
    reader: t`Reader`
  };
  const hasFilters = params.getAll("filter").filter(Boolean).length > 0;

  const newElement = (
    <SplitButton
      leftIcon={<LuPlus />}
      onClick={() => onNew()}
      isDisabled={!canCreate}
      isLoading={isCreating}
      dropdownItems={[
        ...projectElementTypes.map((value) => ({
          label: typeLabels[value],
          icon: <ElementTypeIcon type={value} />,
          onClick: () => onNew(value)
        })),
        {
          label: <Trans>Build from part</Trans>,
          icon: <LuBoxes />,
          onClick: onBuildFromPart
        }
      ]}
    >
      <Trans>New Element</Trans>
    </SplitButton>
  );

  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <Tabs
          value={layout}
          onValueChange={(next) => setParams({ layout: next })}
        >
          <TabsList aria-label={t`Layout`}>
            {projectLayouts.map((value) => (
              <TabsTrigger key={value} value={value}>
                {layoutLabels[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex shrink-0 items-center gap-2">
          {exportHref && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  isIcon
                  variant="secondary"
                  aria-label={t`Export PDF`}
                >
                  <a href={exportHref} target="_blank" rel="noreferrer">
                    <LuFileText />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Export PDF</Trans>
              </TooltipContent>
            </Tooltip>
          )}
          {!hasFilters && <Filter filters={filters} />}
          {planLockMessage ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled button fires no pointer events: the span does. */}
                <span tabIndex={0}>{newElement}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                {planLockMessage}
              </TooltipContent>
            </Tooltip>
          ) : (
            newElement
          )}
        </div>
      </div>
      {hasFilters && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-1.5">
          <ActiveFilters filters={filters} />
        </div>
      )}
    </div>
  );
}
