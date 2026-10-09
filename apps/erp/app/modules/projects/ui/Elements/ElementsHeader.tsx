// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  Combobox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { IconType } from "react-icons";
import {
  LuChevronDown,
  LuKanban,
  LuListTree,
  LuPlus,
  LuSettings2,
  LuSheet
} from "react-icons/lu";
import { SearchFilter } from "~/components";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useUrlParams } from "~/hooks";
import type { ProjectElementType } from "../../projects.models";
import { projectElementTypes } from "../../projects.models";
import type {
  ElementDisplay,
  ElementDisplayProperty,
  ElementGrouping
} from "./ElementProperties";
import {
  elementDisplayProperties,
  elementGroupings,
  useElementDisplayLabels,
  useElementGroupingLabels
} from "./ElementProperties";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";

export const elementLayouts = ["list", "board", "table"] as const;
export type ElementLayout = (typeof elementLayouts)[number];

const layoutIcons: Record<ElementLayout, IconType> = {
  list: LuListTree,
  board: LuKanban,
  table: LuSheet
};

type ElementsHeaderProps = {
  count: number;
  layout: ElementLayout;
  type: ProjectElementType | null;
  filters: ColumnFilter[];
  display: ElementDisplay;
  onDisplayChange: (property: ElementDisplayProperty, shown: boolean) => void;
  onNew: (type: ProjectElementType) => void;
  canCreate: boolean;
  /** The Table layout's grouping; the Display popover offers it when set. */
  grouping?: ElementGrouping;
  onGroupingChange?: (grouping: ElementGrouping) => void;
};

export function ElementsHeader({
  count,
  layout,
  type,
  filters,
  display,
  onDisplayChange,
  onNew,
  canCreate,
  grouping,
  onGroupingChange
}: ElementsHeaderProps) {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();
  const typeLabels = useElementTypeLabels();
  const displayLabels = useElementDisplayLabels();
  const groupingLabels = useElementGroupingLabels();
  const layoutLabels: Record<ElementLayout, string> = {
    list: t`List`,
    board: t`Board`,
    table: t`Table`
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
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-hide">
            <TypeButton
              isActive={type === null}
              onClick={() => setParams({ type: null })}
            >
              <Trans>All</Trans>
            </TypeButton>
            {projectElementTypes.map((value) => (
              <TypeButton
                key={value}
                isActive={type === value}
                onClick={() => setParams({ type: value })}
              >
                <ElementTypeIcon type={value} className="size-3.5" />
                {typeLabels[value]}
              </TypeButton>
            ))}
          </div>
        </HStack>

        <HStack spacing={2} className="shrink-0">
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
                onValueChange={(next) =>
                  setParams({ layout: next === "list" ? null : next })
                }
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
          {!hasFilters && <Filter filters={filters} />}
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                aria-label={t`Display`}
                icon={<LuSettings2 />}
                variant="secondary"
              />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              <VStack spacing={3}>
                {grouping && onGroupingChange && (
                  <>
                    <span className="text-xs font-medium text-muted-foreground">
                      <Trans>Group by</Trans>
                    </span>
                    <div className="w-full">
                      <Combobox
                        asButton
                        size="sm"
                        value={grouping}
                        options={elementGroupings.map((value) => ({
                          value,
                          label: groupingLabels[value]
                        }))}
                        onChange={(value) =>
                          onGroupingChange((value as ElementGrouping) || "none")
                        }
                      />
                    </div>
                  </>
                )}
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Shown properties</Trans>
                </span>
                <VStack spacing={2}>
                  {elementDisplayProperties.map((property) => (
                    <Switch
                      key={property}
                      variant="small"
                      label={displayLabels[property]}
                      checked={display[property]}
                      onCheckedChange={(checked) =>
                        onDisplayChange(property, checked)
                      }
                    />
                  ))}
                </VStack>
              </VStack>
            </PopoverContent>
          </Popover>
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

function TypeButton({
  isActive,
  onClick,
  children
}: {
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
