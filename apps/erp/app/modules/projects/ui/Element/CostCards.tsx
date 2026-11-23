// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  InputGroup,
  InputLeftElement
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  LuArrowDownUp,
  LuChevronDown,
  LuListFilter,
  LuPackage,
  LuReceipt,
  LuSearch,
  LuTimer
} from "react-icons/lu";
import type { CostTypeFilter } from "./cost-cards";
import type { PlanLineType } from "./plan-rows";

const TYPE_ICONS: Record<PlanLineType, typeof LuPackage> = {
  material: LuPackage,
  labor: LuTimer,
  cost: LuReceipt
};

export function CostTypeIcon({
  type,
  className
}: {
  type: PlanLineType;
  className?: string;
}) {
  const Icon = TYPE_ICONS[type];
  return (
    <Icon className={cn("size-4 shrink-0 text-muted-foreground", className)} />
  );
}

export function useCostTypeLabels(): Record<PlanLineType, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({ material: t`Material`, labor: t`Labor`, cost: t`Cost` }),
    [t]
  );
}

/**
 * One line of the element's costs as a small card: the type icon, a title
 * line, a muted figures line, and the actions at the right. With `onOpen`
 * the whole card opens the line (the title is the button, stretched over
 * the card; the actions sit above it).
 */
export function CostCard({
  type,
  title,
  subtitle,
  badges,
  figures,
  actions,
  isOver,
  progress,
  onOpen
}: {
  type: PlanLineType;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  figures?: ReactNode;
  actions?: ReactNode;
  isOver?: boolean;
  /** 0 to 1: draws a thin bar under the card. */
  progress?: number;
  onOpen?: () => void;
}) {
  return (
    <div className="group relative flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40">
      <CostTypeIcon type={type} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="min-w-0 shrink truncate text-left font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {title}
            </button>
          ) : (
            <span className="min-w-0 shrink truncate font-medium">{title}</span>
          )}
          {subtitle && (
            <span className="min-w-0 truncate text-muted-foreground">
              {subtitle}
            </span>
          )}
          {badges && (
            <span className="relative z-10 flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              {badges}
            </span>
          )}
        </div>
        {figures && (
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs tabular-nums text-muted-foreground",
              isOver && "text-red-600 dark:text-red-400"
            )}
          >
            {figures}
          </div>
        )}
      </div>
      {actions && (
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          {actions}
        </div>
      )}
      {progress !== undefined && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-muted">
          <div
            className={cn(
              "h-full bg-emerald-500 transition-[width]",
              isOver && "bg-red-500"
            )}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** A `·` between two figures of a card. */
export function FigureSeparator() {
  return <span aria-hidden>·</span>;
}

/**
 * The row above the cards: the search, the type and sort menus, and the
 * tab's own action at the right.
 */
export function CostToolbar<S extends string>({
  search,
  onSearchChange,
  type,
  onTypeChange,
  sort,
  sorts,
  onSortChange,
  action
}: {
  search: string;
  onSearchChange: (value: string) => void;
  type: CostTypeFilter;
  onTypeChange: (value: CostTypeFilter) => void;
  sort: S;
  sorts: { value: S; label: string }[];
  onSortChange: (value: S) => void;
  action?: ReactNode;
}) {
  const { t } = useLingui();
  const typeLabels = useCostTypeLabels();
  const typeOptions: { value: CostTypeFilter; label: string }[] = [
    { value: "all", label: t`All types` },
    { value: "material", label: typeLabels.material },
    { value: "labor", label: typeLabels.labor },
    { value: "cost", label: typeLabels.cost }
  ];
  const typeLabel =
    typeOptions.find((option) => option.value === type)?.label ?? "";
  const sortLabel = sorts.find((option) => option.value === sort)?.label ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup size="sm" className="w-48">
        <InputLeftElement>
          <LuSearch className="size-4 text-muted-foreground" />
        </InputLeftElement>
        <Input
          aria-label={t`Search costs`}
          placeholder={t`Search`}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </InputGroup>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<LuListFilter />}
            rightIcon={<LuChevronDown />}
          >
            {typeLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={type}
            onValueChange={(value) => onTypeChange(value as CostTypeFilter)}
          >
            {typeOptions.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<LuArrowDownUp />}
            rightIcon={<LuChevronDown />}
          >
            {sortLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => onSortChange(value as S)}
          >
            {sorts.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

/** The muted line a filter leaves when it hides every card. */
export function NoMatchingCosts({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}
